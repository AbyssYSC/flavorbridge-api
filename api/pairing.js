// api/pairing.js —— FlavorBridge 后端(DeepSeek 版)
// DeepSeek 兼容 OpenAI 接口格式,用 fetch 直接调,不需要额外安装库

// DeepSeek 要求的 JSON 结构,写进提示里让它严格遵守
const JSON_SHAPE = `{
  "flavor_profile": { "sweet": 数字1-10, "sour": 数字, "bitter": 数字, "umami": 数字, "fat": 数字 },
  "pairings": [
    {
      "name": "酒名",
      "type": "cocktail 或 wine",
      "recipe": [ { "ingredient": "材料", "amount": "用量如45ml" } ],
      "reason": "从化学或味觉角度解释为何匹配",
      "uses_only_available": true 或 false,
      "substitutions": [ { "missing": "缺的材料", "replace_with": "平价替代" } ]
    }
  ]
}`;

async function callDeepSeek(target, targetType, availableItems) {
  const itemsText = availableItems && availableItems.length ? availableItems.join('、') : '(未填写库存)';
  const userPrompt = [
    '用户选择的' + (targetType === 'spirit' ? '基酒' : '主菜食材') + '是:「' + target + '」。',
    '用户家里现有的库存是:' + itemsText + '。',
    '请分析其风味轮廓(甜酸苦鲜脂各1-10分),基于风味桥梁理论推荐正好3款搭配,优先用库存,缺辅料给平价替代,每个都写清搭配理由。',
    '必须严格按以下 JSON 结构返回,不要输出任何多余文字:',
    JSON_SHAPE,
  ].join('\n');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 从环境变量读 DeepSeek 的 key
      'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是精通风味科学与调酒的侍酒师。只返回 JSON,不要任何多余文字。' },
        { role: 'user', content: userPrompt },
      ],
      // 这一行让 DeepSeek 强制返回合法 JSON,防止它乱说话
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    }),
  });

  const result = await response.json();
  // DeepSeek 把内容放在 choices[0].message.content,是个 JSON 字符串,要解析
  const content = result.choices && result.choices[0] && result.choices[0].message.content;
  if (!content) {
    throw new Error('DeepSeek 返回异常: ' + JSON.stringify(result));
  }
  return JSON.parse(content);
}

module.exports = async (req, res) => {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 浏览器直接打开(GET)= 测试模式
  if (req.method === 'GET') {
    try {
      const data = await callDeepSeek('鸡胸肉', 'ingredient', ['柠檬', '蜂蜜', '薄荷']);
      return res.status(200).json({ success: true, mode: 'test', data });
    } catch (err) {
      return res.status(500).json({ error: '调用失败', detail: String(err && err.message) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });
  const { target, targetType, availableItems } = req.body || {};
  if (!target || !targetType) return res.status(400).json({ error: '缺少 target 或 targetType 参数' });
  try {
    const data = await callDeepSeek(target, targetType, availableItems);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: '生成搭配时出错', detail: String(err && err.message) });
  }
};
