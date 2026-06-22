// api/pairing.js —— FlavorBridge 后端接口
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PAIRING_TOOL = {
  name: 'build_flavor_pairing',
  description: '根据食材风味轮廓,生成搭配的鸡尾酒或佐餐酒方案',
  input_schema: {
    type: 'object',
    properties: {
      flavor_profile: {
        type: 'object',
        properties: { sweet: { type: 'integer' }, sour: { type: 'integer' }, bitter: { type: 'integer' }, umami: { type: 'integer' }, fat: { type: 'integer' } },
        required: ['sweet', 'sour', 'bitter', 'umami', 'fat'],
      },
      pairings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['cocktail', 'wine'] },
            recipe: { type: 'array', items: { type: 'object', properties: { ingredient: { type: 'string' }, amount: { type: 'string' } }, required: ['ingredient', 'amount'] } },
            reason: { type: 'string' },
            uses_only_available: { type: 'boolean' },
            substitutions: { type: 'array', items: { type: 'object', properties: { missing: { type: 'string' }, replace_with: { type: 'string' } }, required: ['missing', 'replace_with'] } },
          },
          required: ['name', 'type', 'recipe', 'reason', 'uses_only_available', 'substitutions'],
        },
      },
    },
    required: ['flavor_profile', 'pairings'],
  },
};

async function callClaude(target, targetType, availableItems) {
  const itemsText = availableItems && availableItems.length ? availableItems.join('、') : '(未填写库存)';
  const userPrompt = [
    '用户选择的' + (targetType === 'spirit' ? '基酒' : '主菜食材') + '是:「' + target + '」。',
    '用户家里现有的库存是:' + itemsText + '。',
    '请分析其风味轮廓(甜酸苦鲜脂各1-10分),基于风味桥梁理论推荐正好3款搭配,优先用库存,缺辅料给平价替代,每个都写清搭配理由。务必通过工具返回。',
  ].join('\n');
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: '你是精通风味科学与调酒的侍酒师。只能通过工具返回结构化结果,不要输出额外文字。',
    tools: [PAIRING_TOOL],
    tool_choice: { type: 'tool', name: 'build_flavor_pairing' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  return toolBlock ? toolBlock.input : null;
}

module.exports = async (req, res) => {
  // 允许跨域(让浏览器测试工具也能调)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 浏览器直接打开(GET)= 测试模式,用固定数据调一次 Claude
  if (req.method === 'GET') {
    try {
      const data = await callClaude('鸡胸肉', 'ingredient', ['柠檬', '蜂蜜', '薄荷']);
      if (!data) return res.status(500).json({ error: 'AI 未返回预期数据' });
      return res.status(200).json({ success: true, mode: 'test', data });
    } catch (err) {
      return res.status(500).json({ error: '调用失败', detail: String(err && err.message) });
    }
  }

  // 正式请求(POST)
  if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });
  const { target, targetType, availableItems } = req.body || {};
  if (!target || !targetType) return res.status(400).json({ error: '缺少 target 或 targetType 参数' });
  try {
    const data = await callClaude(target, targetType, availableItems);
    if (!data) return res.status(500).json({ error: 'AI 未返回预期数据,请重试' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: '请求太频繁,请稍后再试' });
    return res.status(500).json({ error: '生成搭配时出错', detail: String(err && err.message) });
  }
};
