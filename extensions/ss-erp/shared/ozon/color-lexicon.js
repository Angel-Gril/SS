// 通用颜色词典：中文（1688）常见颜色词 → Ozon 俄语词典查询词。
//
// 为什么需要它：颜色此前只能靠视觉模型输出「属性观察」拿到，模型某次输出格式一变
// 就整条商品缺颜色、预检不过。而采集到的标题/描述里本来就有颜色词，没理由不用。
//
// 这里只放与商品无关的颜色知识，不含任何具体类目或具体商品。

const COLORS = [
  { zh: ['黑色', '黑'], ru: 'черный' },
  { zh: ['白色', '白'], ru: 'белый' },
  { zh: ['深灰', '深灰色', '炭灰', '炭灰色'], ru: 'темно-серый' },
  { zh: ['浅灰', '浅灰色', '灰'], ru: 'серый' },
  { zh: ['深蓝', '藏青', '藏蓝色', '海军蓝'], ru: 'темно-синий' },
  { zh: ['浅蓝', '天蓝', '蓝色', '蓝'], ru: 'синий' },
  { zh: ['深绿', '墨绿', '墨绿色', '军绿', '军绿色'], ru: 'темно-зеленый' },
  { zh: ['浅绿', '绿色', '绿'], ru: 'зеленый' },
  { zh: ['酒红', '酒红色', '深红', '深红色'], ru: 'бордовый' },
  { zh: ['红色', '红'], ru: 'красный' },
  { zh: ['咖色', '咖啡色', '棕色', '褐色', '驼色'], ru: 'коричневый' },
  { zh: ['米色', '米白', '米白色', '杏色'], ru: 'бежевый' },
  { zh: ['粉色', '粉红', '粉'], ru: 'розовый' },
  { zh: ['紫色', '紫'], ru: 'фиолетовый' },
  { zh: ['黄色', '黄'], ru: 'желтый' },
  { zh: ['橙色', '橙'], ru: 'оранжевый' },
  { zh: ['卡其', '卡其色'], ru: 'хаки' },
  { zh: ['金银色', '银色', '银', '灰色亮片'], ru: 'серебристый' },
  { zh: ['金色', '香槟金'], ru: 'золотистый' },
];

const norm = (text) => String(text || '').toLowerCase();

/**
 * 从一段中文文本里找出所有颜色词，按出现顺序返回俄语查询词。
 * 长词优先（"深灰色" 先于 "灰色"），避免把 "深灰" 判成 "灰"。
 */
export function colorsFromText(text) {
  const source = norm(text);
  if (!source) return [];
  const found = [];
  const ordered = COLORS.flatMap((entry) => entry.zh.map((zh) => ({ zh, ru: entry.ru })))
    .sort((a, b) => b.zh.length - a.zh.length);
  let rest = source;
  for (const item of ordered) {
    if (!rest.includes(item.zh)) continue;
    if (!found.includes(item.ru)) found.push(item.ru);
    rest = rest.split(item.zh).join(' ');
  }
  return found;
}

/** 文本里第一个颜色词（用于单值属性） */
export function firstColorFromText(text) {
  const all = colorsFromText(text);
  return all.length ? all[0] : '';
}
