// api/pairing.js —— FlavorBridge 后端接口(部署在 Vercel)
// 作用:接收 App 传来的食材/库存 → 调用 Claude → 返回严格 JSON
// API key 从环境变量读,绝不进前端

const Anthropic = require('@anthropic-ai/sdk');

// 用环境变量里的密钥初始化(变量名要和 Vercel 后台设的一致)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 强制 Claude 按这个结构返回的"工具"定义,防止它乱说话
const PAIRING_TOOL = {
  name: 'build_flavor_pairing',
  description: '根据食材风味轮廓,生成搭配的鸡尾酒或佐餐酒方案',
  input_schema: {
    type: 'object',
    properties: {
      flavor_profile: {
        type: 'object',
        properties: {
          sweet: { type: 'integer' }, sour: { type: 'integer' },
          bitter: { type: 'integer' }, umami: { type: 'integer' }, fat: { type: 'integer' },
        },
        required: ['sweet', 'sour', 'bitter', 'umami', 'fat'],
      },
      pairings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['cocktail', 'wine'] },
            recipe: {
              type: 'array',
              items: {
                type: 'object',
                properties: { ingredient: { type: 'string' }, amount: { type: 'string' } },
                required: ['ingredient', 'amount'],
              },
            },
            reason: { type: 'string' },
            uses_only_available: { type: 'boolean' },
            substitutions: {
              type: 'array',
              items: {
                type: 'object',
                properties: { missing: { type: 'string' }, replace_with: { type: 'string' } },
                required: ['missing', 'replace_with'],
              },
            },
          },
          required: ['name', 'type', 'recipe', 'reason', 'uses_only_available', 'substitutions'],
        },
      },
    },
    required: ['flavor_profile', 'pairings'],
  },
};

// Vercel 接口入口
module.exports = async (req, res) => {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST' });
  }

  // 取出 App 传来的参数
  const { target, targetType, availableItems } = req.body || {};
  if (!target || !targetType) {
    return res.status(400).json({ error: '缺少 target 或 targetType 参数' });
  }

  const itemsText = availableItems && availableItems.length ? availableItems.join('、') : '(未填写库存)';
  const userPrompt = [
    '用户选择的' + (targetType === 'spirit' ? '基酒' : '主菜食材') + '是:「' + target + '」。',
    '用户家里现有的库存是:' + itemsText + '。',
    '请你:',
    '1. 先分析「' + target + '」的风味轮廓(甜、酸、苦、鲜、脂肪感,各 1-10 分)。',
    '2. 基于"风味桥梁理论",推荐正好 3 款搭配。',
    '3. 优先使用用户已有库存。若缺关键辅料,必须在 substitutions 里给出平价替代。',
    '4. 每个搭配都要写清楚搭配理由,从化学或味觉角度解释为何匹配。',
    '务必通过 build_flavor_pairing 工具返回结果。',
  ].join('\n');

  try {
    // 调用 Claude
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      system: '你是一位精通风味科学与调酒的侍酒师。搭配必须基于真实味觉/化学原理,配方比例专业可执行。只能通过工具返回结构化结果,不要输出额外文字。',
      tools: [PAIRING_TOOL],
      tool_choice: { type: 'tool', name: 'build_flavor_pairing' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    // 取出工具调用结果(SDK 已解析成对象)
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || !toolBlock.input) {
      return res.status(500).json({ error: 'AI 未返回预期数据,请重试' });
    }

    // 返回给 App
    return res.status(200).json({ success: true, data: toolBlock.input });
  } catch (err) {
    console.error('Claude 调用失败:', err);
    if (err.status === 429) {
      return res.status(429).json({ error: '请求太频繁,请稍后再试' });
    }
    return res.status(500).json({ error: '生成搭配时出错,请稍后重试' });
  }
};
