import { describe, expect, it, vi } from 'vitest'
import { parseQuickAddWithAi } from '../src/main/ai'
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS,
  AI_QUICK_ADD_MAX_TOKENS,
  ruleQuickAdd,
  type AiConfig
} from '../src/shared/ai'
import type { QuickAddResult } from '../src/shared/quick-add'

/**
 * 快速添加准确率回归集。
 *
 * 全部用例固定在同一时刻（2026-11-05 周四 09:00），避免“明天/下周一”随时钟漂移。
 * 规则用例覆盖日期、时间、重复、显式标记与边界情况；
 * AI 用例用假 fetch 模拟真实模型输出，校验“解析 → 归一化 → 与规则合并”后的最终落库结果。
 * 新增解析能力时先在这里补一条用例，再改实现。
 */
const NOW = new Date(2026, 10, 5, 9, 0, 0)

const LISTS = ['收集箱', '工作', '家庭', '健康']

const CONFIG: AiConfig = {
  enabled: true,
  baseUrl: AI_DEFAULT_BASE_URL,
  model: AI_DEFAULT_MODEL,
  token: '',
  timeoutMs: AI_DEFAULT_TIMEOUT_MS
}

type Expected = Partial<QuickAddResult> & { title: string }

/** 未写出的字段使用默认值，等价于“无日期、无标签、普通优先级、全天”。 */
function full(expected: Expected): QuickAddResult {
  return {
    title: expected.title,
    priority: expected.priority ?? 0,
    tags: expected.tags ?? [],
    listName: expected.listName ?? null,
    dueDate: expected.dueDate ?? null,
    dueTime: expected.dueTime ?? null,
    allDay: expected.allDay ?? true,
    recurrence: expected.recurrence ?? null,
    reminderOffsetMin: expected.reminderOffsetMin ?? null
  }
}

interface RuleCase {
  input: string
  expected: Expected
}

const RULE_CASES: RuleCase[] = [
  // 日期：相对日期、星期、月日、跨年
  { input: '今天 买菜', expected: { title: '买菜', dueDate: '2026-11-05' } },
  { input: '大后天 交房租', expected: { title: '交房租', dueDate: '2026-11-08' } },
  { input: '周五 聚餐', expected: { title: '聚餐', dueDate: '2026-11-06' } },
  { input: '本周五 复盘', expected: { title: '复盘', dueDate: '2026-11-06' } },
  { input: '下周一 晨会', expected: { title: '晨会', dueDate: '2026-11-09' } },
  { input: '下周日 家庭日', expected: { title: '家庭日', dueDate: '2026-11-15' } },
  { input: '下个星期天 爬山', expected: { title: '爬山', dueDate: '2026-11-15' } },
  { input: '上周五 复盘', expected: { title: '复盘', dueDate: '2026-10-30' } },
  { input: '上上周五 复盘', expected: { title: '复盘', dueDate: '2026-10-23' } },
  { input: '下下周三 评审', expected: { title: '评审', dueDate: '2026-11-18' } },
  { input: '下下个星期五 复盘', expected: { title: '复盘', dueDate: '2026-11-20' } },
  { input: '下下个月15号 续费', expected: { title: '续费', dueDate: '2027-01-15' } },
  { input: '上个月15号 补录', expected: { title: '补录', dueDate: '2026-10-15' } },
  { input: '下个月15号 还信用卡', expected: { title: '还信用卡', dueDate: '2026-12-15' } },
  { input: '下个月十五号 还信用卡', expected: { title: '还信用卡', dueDate: '2026-12-15' } },
  { input: '三月五号 体检', expected: { title: '体检', dueDate: '2027-03-05' } },
  { input: '十二月三十一号 年终', expected: { title: '年终', dueDate: '2026-12-31' } },
  { input: '下个月 复盘', expected: { title: '复盘', dueDate: '2026-12-05' } },
  { input: '本月20号 交水电费', expected: { title: '交水电费', dueDate: '2026-11-20' } },
  { input: '11月20日 妈妈生日', expected: { title: '妈妈生日', dueDate: '2026-11-20' } },
  { input: '12/24 平安夜活动', expected: { title: '平安夜活动', dueDate: '2026-12-24' } },
  { input: '2026-12-01 14:00 年度规划', expected: { title: '年度规划', dueDate: '2026-12-01', dueTime: '14:00', allDay: false } },
  { input: '2027年1月1日 元旦计划', expected: { title: '元旦计划', dueDate: '2027-01-01' } },
  { input: '3天后 复诊', expected: { title: '复诊', dueDate: '2026-11-08' } },
  { input: '2周后 复盘', expected: { title: '复盘', dueDate: '2026-11-19' } },
  { input: '3个月后 复查', expected: { title: '复查', dueDate: '2027-02-05' } },

  // 时间：时段、半点、中文/数字时间与区间
  { input: '15:30 开会', expected: { title: '开会', dueDate: '2026-11-05', dueTime: '15:30', allDay: false } },
  { input: '下午3点半 面试', expected: { title: '面试', dueDate: '2026-11-05', dueTime: '15:30', allDay: false } },
  { input: '中午12点 午饭', expected: { title: '午饭', dueDate: '2026-11-05', dueTime: '12:00', allDay: false } },
  { input: '凌晨1点 看球', expected: { title: '看球', dueDate: '2026-11-05', dueTime: '01:00', allDay: false } },
  { input: '晚上8点 看电影', expected: { title: '看电影', dueDate: '2026-11-05', dueTime: '20:00', allDay: false } },
  { input: '明天早上7点 跑步', expected: { title: '跑步', dueDate: '2026-11-06', dueTime: '07:00', allDay: false } },
  { input: '明天 10点到11点 面试', expected: { title: '面试', dueDate: '2026-11-06', dueTime: '10:00', allDay: false } },
  { input: '明天 15:30-16:30 面试', expected: { title: '面试', dueDate: '2026-11-06', dueTime: '15:30', allDay: false } },
  { input: '下午2点到4点 评审', expected: { title: '评审', dueDate: '2026-11-05', dueTime: '14:00', allDay: false } },
  // 只说时段没说钟点：按该时段的默认钟点（下午=15:00），而不是整天无时间
  { input: '下午 开会', expected: { title: '开会', dueDate: '2026-11-05', dueTime: '15:00', allDay: false } },
  { input: '明天下午 开会', expected: { title: '开会', dueDate: '2026-11-06', dueTime: '15:00', allDay: false } },
  // “今晚/明早/昨晚”= 日期词 + 时段词
  { input: '今晚8点 看电影', expected: { title: '看电影', dueDate: '2026-11-05', dueTime: '20:00', allDay: false } },
  { input: '今晚 看电影', expected: { title: '看电影', dueDate: '2026-11-05', dueTime: '20:00', allDay: false } },
  { input: '明早 跑步', expected: { title: '跑步', dueDate: '2026-11-06', dueTime: '08:00', allDay: false } },
  { input: '明晚 加班', expected: { title: '加班', dueDate: '2026-11-06', dueTime: '20:00', allDay: false } },
  { input: '昨晚 复盘', expected: { title: '复盘', dueDate: '2026-11-04', dueTime: '20:00', allDay: false } },
  // “下午茶/晚上好”是普通词语，不能当时间吞掉
  { input: '下午茶 约客户', expected: { title: '下午茶 约客户' } },
  { input: '晚上好 发消息', expected: { title: '晚上好 发消息' } },
  // 相对当前时刻：分钟/小时，精确到分钟
  { input: '30分钟后 喝水', expected: { title: '喝水', dueDate: '2026-11-05', dueTime: '09:30', allDay: false } },
  { input: '半小时后 出发', expected: { title: '出发', dueDate: '2026-11-05', dueTime: '09:30', allDay: false } },
  { input: '一个半小时后 出发', expected: { title: '出发', dueDate: '2026-11-05', dueTime: '10:30', allDay: false } },
  { input: '一小时二十分钟后 休息', expected: { title: '休息', dueDate: '2026-11-05', dueTime: '10:20', allDay: false } },
  { input: '一小时后 休息', expected: { title: '休息', dueDate: '2026-11-05', dueTime: '10:00', allDay: false } },
  // 中文数量的相对日期
  { input: '两周后 复盘', expected: { title: '复盘', dueDate: '2026-11-19' } },
  { input: '三个月后 复查', expected: { title: '复查', dueDate: '2027-02-05' } },
  { input: '一年后 复盘', expected: { title: '复盘', dueDate: '2027-11-05' } },
  // 月末/月初/周末
  { input: '月底 交房租', expected: { title: '交房租', dueDate: '2026-11-30' } },
  { input: '下个月初 交房租', expected: { title: '交房租', dueDate: '2026-12-01' } },
  { input: '12月底 盘点', expected: { title: '盘点', dueDate: '2026-12-31' } },
  { input: '十二月底 盘点', expected: { title: '盘点', dueDate: '2026-12-31' } },
  { input: '上个月底 复盘', expected: { title: '复盘', dueDate: '2026-10-31' } },
  { input: '下下个月底 复盘', expected: { title: '复盘', dueDate: '2027-01-31' } },
  { input: '本周末 爬山', expected: { title: '爬山', dueDate: '2026-11-07' } },
  { input: '下周末 露营', expected: { title: '露营', dueDate: '2026-11-14' } },

  // 重复：每天/每周多日/每月/每年/工作日
  { input: '每天晚上9点 阅读', expected: { title: '阅读', dueDate: '2026-11-05', dueTime: '21:00', allDay: false, recurrence: 'FREQ=DAILY' } },
  { input: '每晚9点 阅读', expected: { title: '阅读', dueDate: '2026-11-05', dueTime: '21:00', allDay: false, recurrence: 'FREQ=DAILY' } },
  { input: '每早8点 跑步', expected: { title: '跑步', dueDate: '2026-11-05', dueTime: '08:00', allDay: false, recurrence: 'FREQ=DAILY' } },
  { input: '每周一 晨会', expected: { title: '晨会', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;BYDAY=MO' } },
  { input: '每周一三五 健身', expected: { title: '健身', dueDate: '2026-11-06', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' } },
  { input: '每周二、周四 晨跑', expected: { title: '晨跑', dueDate: '2026-11-05', recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH' } },
  { input: '每月1号 交房租', expected: { title: '交房租', dueDate: '2026-12-01', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=1' } },
  { input: '每月最后一天 对账', expected: { title: '对账', dueDate: '2026-11-30', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=-1' } },
  { input: '每年3月5日 体检', expected: { title: '体检', dueDate: '2027-03-05', recurrence: 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=5' } },
  { input: '每个工作日 打卡', expected: { title: '打卡', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } },
  { input: '每周工作日 整理周报', expected: { title: '整理周报', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } },
  { input: '每周 写周报', expected: { title: '写周报', dueDate: '2026-11-05', recurrence: 'FREQ=WEEKLY' } },
  { input: '每个周二 晨会', expected: { title: '晨会', dueDate: '2026-11-10', recurrence: 'FREQ=WEEKLY;BYDAY=TU' } },
  { input: '每个周一、周三 健身', expected: { title: '健身', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE' } },
  { input: '每周的周二 晨会', expected: { title: '晨会', dueDate: '2026-11-10', recurrence: 'FREQ=WEEKLY;BYDAY=TU' } },
  { input: '每周的周一到周五 早会', expected: { title: '早会', dueDate: '2026-11-05', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } },
  // 每个月口语、多个每月日期、多个第 N 个星期与最后一个工作日
  { input: '每个月的最后一天 对账', expected: { title: '对账', dueDate: '2026-11-30', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=-1' } },
  { input: '每月的1号和15号 对账', expected: { title: '对账', dueDate: '2026-11-15', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=1,15' } },
  { input: '每月1号、15号、28号 还款', expected: { title: '还款', dueDate: '2026-11-15', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=1,15,28' } },
  { input: '每月最后一个工作日 对账', expected: { title: '对账', dueDate: '2026-11-30', recurrence: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1' } },
  { input: '每月第2个和第4个周二 复盘', expected: { title: '复盘', dueDate: '2026-11-10', recurrence: 'FREQ=MONTHLY;BYDAY=2TU,4TU' } },
  { input: '每季度第一天 复盘', expected: { title: '复盘', dueDate: '2027-01-01', recurrence: 'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1' } },
  { input: '每季度最后一天 结转', expected: { title: '结转', dueDate: '2026-12-31', recurrence: 'FREQ=YEARLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1' } },
  { input: '隔天 浇花', expected: { title: '浇花', dueDate: '2026-11-05', recurrence: 'FREQ=DAILY;INTERVAL=2' } },
  // 带“本周/下周/上周”的星期区间是一次性日期范围，不写重复规则
  { input: '下周一到周五 出差', expected: { title: '出差', dueDate: '2026-11-09' } },
  { input: '本周五到周日 团建', expected: { title: '团建', dueDate: '2026-11-06' } },
  { input: '本周一到周三 早会', expected: { title: '早会', dueDate: '2026-11-09' } },
  { input: '上周一到周三 复盘', expected: { title: '复盘', dueDate: '2026-10-26' } },
  // 周期 + 星期：INTERVAL 与 BYDAY 同时保留，首次日期取最近的星期
  { input: '每两周的周二 复盘', expected: { title: '复盘', dueDate: '2026-11-10', recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU' } },
  { input: '每2周的周一、周三 例会', expected: { title: '例会', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' } },
  { input: '每两周的周一到周五 早会', expected: { title: '早会', dueDate: '2026-11-05', recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR' } },
  { input: '每周末 打扫', expected: { title: '打扫', dueDate: '2026-11-07', recurrence: 'FREQ=WEEKLY;BYDAY=SA,SU' } },
  { input: '每月底 结转', expected: { title: '结转', dueDate: '2026-11-30', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=-1' } },
  // 重复 + 时段：首次日期跟重复走（周五），不被“下午”默认成今天
  { input: '每周五下午 总结', expected: { title: '总结', dueDate: '2026-11-06', dueTime: '15:00', allDay: false, recurrence: 'FREQ=WEEKLY;BYDAY=FR' } },

  // 提前提醒：分钟/小时/天/中文数字，以及没有日期时的保留
  { input: '明天下午3点 提前30分钟提醒 交周报', expected: { title: '交周报', dueDate: '2026-11-06', dueTime: '15:00', allDay: false, reminderOffsetMin: 30 } },
  { input: '每周一 提前1小时提醒 晨会', expected: { title: '晨会', dueDate: '2026-11-09', recurrence: 'FREQ=WEEKLY;BYDAY=MO', reminderOffsetMin: 60 } },
  { input: '提前提醒我半小时 交水电费', expected: { title: '交水电费', reminderOffsetMin: 30 } },
  { input: '提前一天通知我 交房租', expected: { title: '交房租', reminderOffsetMin: 1440 } },
  { input: '提醒我提前半小时 交水电费', expected: { title: '交水电费', reminderOffsetMin: 30 } },
  { input: '提醒我提前30分钟，交周报', expected: { title: '交周报', reminderOffsetMin: 30 } },
  { input: '提前一个半小时提醒 开会', expected: { title: '开会', reminderOffsetMin: 90 } },
  { input: '提前一小时二十分钟提醒 开会', expected: { title: '开会', reminderOffsetMin: 80 } },
  { input: '提前两天半提醒 交房租', expected: { title: '交房租', reminderOffsetMin: 3600 } },
  { input: '提醒我提前30分钟出发', expected: { title: '提醒我提前30分钟出发' } },
  { input: '提前30分钟出发', expected: { title: '提前30分钟出发' } },

  // 显式语法：标签/优先级/清单，含中文标点与无空格连写
  { input: '明天下午3点 交周报 #工作 !高', expected: { title: '交周报', dueDate: '2026-11-06', dueTime: '15:00', allDay: false, priority: 3, tags: ['工作'] } },
  { input: '~工作 写OKR !中 #季度', expected: { title: '写OKR', priority: 2, tags: ['季度'], listName: '工作' } },
  { input: '交周报 #工作，!高 ~工作', expected: { title: '交周报', priority: 3, tags: ['工作'], listName: '工作' } },
  { input: '周报 #工作 #重要 !高 ~工作', expected: { title: '周报', priority: 3, tags: ['工作', '重要'], listName: '工作' } },
  { input: '买牛奶 #购物 #超市', expected: { title: '买牛奶', tags: ['购物', '超市'] } },
  { input: '买牛奶 #购物，!高', expected: { title: '买牛奶', priority: 3, tags: ['购物'] } },
  { input: '交周报 #工作!高~工作', expected: { title: '交周报', priority: 3, tags: ['工作'], listName: '工作' } },

  // 边界：纯标题、假日期、空标题保护
  { input: '预订机票', expected: { title: '预订机票' } },
  { input: '买3个苹果', expected: { title: '买3个苹果' } },
  { input: '给妈妈打电话', expected: { title: '给妈妈打电话' } },
  { input: '整理桌面，然后写周报', expected: { title: '整理桌面，然后写周报' } },
  { input: '明天', expected: { title: '新任务', dueDate: '2026-11-06' } },
  { input: '#工作', expected: { title: '新任务', tags: ['工作'] } },
  { input: '!紧急 修复线上问题', expected: { title: '修复线上问题', priority: 3 } },
  { input: '2026-02-30 无效日期', expected: { title: '2026-02-30 无效日期' } }
]

function parseQuickAddWithRule(input: string): QuickAddResult {
  return ruleQuickAdd(input, NOW)
}

describe('快速添加规则解析回归集', () => {
  it.each(RULE_CASES)('$input', ({ input, expected }) => {
    expect(parseQuickAddWithRule(input), input).toEqual(full(expected))
  })

  it('回归集用例唯一且不少于 50 条', () => {
    const inputs = RULE_CASES.map((item) => item.input)
    expect(inputs.length).toBeGreaterThanOrEqual(50)
    expect(new Set(inputs).size).toBe(inputs.length)
  })
})

// ---------------------------------------------------------------------------
// AI 合并回归：假 fetch 返回贴近真实模型的输出，断言最终落库结果。
// ---------------------------------------------------------------------------

interface AiCase {
  name: string
  input: string
  model: unknown
  /** 默认按 Anthropic content blocks 返回，可切换成 OpenAI choices。 */
  kind?: 'anthropic' | 'openai'
  expected: Expected
}

const AI_CASES: AiCase[] = [
  {
    name: '模型漏掉的显式标签和优先级由规则补齐',
    input: '明天下午3点 交周报 #工作 !高',
    model: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      priority: 0,
      tags: [],
      listName: null,
      recurrence: null
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      priority: 3,
      tags: ['工作']
    }
  },
  {
    name: '容忍 Markdown 代码块与前后解释',
    input: '下周一 晨会',
    model: {
      title: '晨会',
      dueDate: '2026-11-09',
      dueTime: null,
      allDay: true,
      priority: 0,
      tags: [],
      listName: null,
      recurrence: null
    },
    expected: { title: '晨会', dueDate: '2026-11-09' }
  },
  {
    name: '模型只返回标题时补齐重复规则与最近一次日期',
    input: '每周一三五 健身',
    model: { title: '健身' },
    expected: {
      title: '健身',
      dueDate: '2026-11-06',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    }
  },
  {
    name: '模型漏掉“下周一到周五”时按一次性日期范围补齐，不产生重复',
    input: '下周一到周五 出差',
    model: { title: '出差' },
    expected: { title: '出差', dueDate: '2026-11-09', recurrence: null }
  },
  {
    name: '模型漏掉多日期每月重复时由规则补齐',
    input: '每月的1号和15号 还款',
    model: { title: '还款' },
    expected: {
      title: '还款',
      dueDate: '2026-11-15',
      recurrence: 'FREQ=MONTHLY;BYMONTHDAY=1,15'
    }
  },
  {
    name: '模型漏掉每月最后一个工作日时由规则补齐',
    input: '每月最后一个工作日 对账',
    model: { title: '对账' },
    expected: {
      title: '对账',
      dueDate: '2026-11-30',
      recurrence: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
    }
  },
  {
    name: '模型没提清单却猜了一个时忽略猜测',
    input: '明天下午3点交周报',
    model: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      priority: 0,
      tags: [],
      listName: '工作',
      recurrence: null
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false
    }
  },
  {
    name: '用户显式写了 ~清单 时保留 AI 的清单',
    input: '~工作 写OKR',
    model: { title: '写OKR', listName: '工作' },
    expected: { title: '写OKR', listName: '工作' }
  },
  {
    name: '用户文字里明确提到清单时采纳',
    input: '把材料放到 工作 清单',
    model: { title: '整理材料', listName: '工作' },
    expected: { title: '整理材料', listName: '工作' }
  },
  {
    name: '没有提到清单时忽略 家庭 猜测',
    input: '给妈妈打电话',
    model: { title: '给妈妈打电话', listName: '家庭' },
    expected: { title: '给妈妈打电话' }
  },
  {
    name: '模型漏掉日期时按规则补齐',
    input: '11月20日 妈妈生日',
    model: { title: '妈妈生日', dueDate: null, dueTime: null },
    expected: { title: '妈妈生日', dueDate: '2026-11-20' }
  },
  {
    name: '非法日期/时间/优先级只丢弃该字段',
    input: '明天 复盘 #工作',
    model: {
      title: '复盘',
      dueDate: '2026-02-30',
      dueTime: '25:99',
      priority: 9,
      tags: ['#工作', '工作', '工作']
    },
    expected: { title: '复盘', dueDate: '2026-11-06', priority: 3, tags: ['工作'] }
  },
  {
    name: '标题里残留的显式标记会被清掉',
    input: '买牛奶 #购物，!高',
    model: { title: '买牛奶 #购物 !高', priority: 0, tags: [] },
    expected: { title: '买牛奶', priority: 3, tags: ['购物'] }
  },
  {
    name: '字符串优先级与重复 # 标签被归一化',
    input: '整理桌面 #工作',
    model: { title: '整理桌面', priority: '高', tags: ['#工作', '#工作'] },
    expected: { title: '整理桌面', priority: 3, tags: ['工作'] }
  },
  {
    name: '兼容 OpenAI choices 响应',
    input: '今晚8点 看电影',
    model: {
      title: '看电影',
      dueDate: '2026-11-05',
      dueTime: '20:00',
      allDay: false,
      priority: 0,
      tags: []
    },
    kind: 'openai',
    expected: {
      title: '看电影',
      dueDate: '2026-11-05',
      dueTime: '20:00',
      allDay: false
    }
  },
  {
    name: '只有 dueTime 时用规则日期补全',
    input: '下午3点半 面试',
    model: { title: '面试', dueDate: null, dueTime: '15:30' },
    expected: {
      title: '面试',
      dueDate: '2026-11-05',
      dueTime: '15:30',
      allDay: false
    }
  },
  {
    name: '显式标签/优先级/清单全部由规则覆盖 AI 的遗漏',
    input: '周报 #工作 #重要 !高 ~工作',
    model: { title: '周报', priority: 0, tags: [], listName: null },
    expected: {
      title: '周报',
      priority: 3,
      tags: ['工作', '重要'],
      listName: '工作'
    }
  },
  {
    name: '模型给出 reminderMinutes 时落成提前提醒',
    input: '明天下午3点 提前45分钟提醒 交周报',
    model: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      reminderMinutes: 45
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      reminderOffsetMin: 45
    }
  },
  {
    name: '模型漏掉提前提醒时由规则补齐',
    input: '明天下午3点 提前30分钟提醒 交周报',
    model: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      reminderOffsetMin: 30
    }
  },
  {
    name: '非法 reminderMinutes 被丢弃且不创建提醒',
    input: '明天下午3点 交周报',
    model: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      reminderMinutes: 999999
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false
    }
  },
  {
    name: 'recurrence 小写会被规范成 RRULE',
    input: '每天 喝水',
    model: { title: '喝水', dueDate: '2026-11-05', recurrence: 'freq=daily' },
    expected: {
      title: '喝水',
      dueDate: '2026-11-05',
      recurrence: 'FREQ=DAILY'
    }
  },
  {
    name: '模型返回非法 INTERVAL 时清理为合法 RRULE',
    input: '每3天 浇花',
    model: { title: '浇花', recurrence: 'FREQ=DAILY;INTERVAL=0' },
    expected: { title: '浇花', dueDate: '2026-11-05', recurrence: 'FREQ=DAILY' }
  },
  {
    name: '模型返回未知 FREQ 时回落到规则解析',
    input: '每3天 浇花',
    model: { title: '浇花', recurrence: 'FREQ=HOURLY' },
    expected: {
      title: '浇花',
      dueDate: '2026-11-05',
      recurrence: 'FREQ=DAILY;INTERVAL=3'
    }
  },
  {
    name: '模型用中文写 recurrence 时翻译成 RRULE',
    input: '交周报',
    model: { title: '交周报', recurrence: '每月最后一个周五' },
    expected: {
      title: '交周报',
      recurrence: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'
    }
  },
  {
    name: '模型只返回标题时补齐每月第 N 个星期与下一次日期',
    input: '每月第一个周一 例会',
    model: { title: '例会' },
    expected: {
      title: '例会',
      dueDate: '2026-12-07',
      recurrence: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1'
    }
  },
  {
    name: '模型明确给出的日期/时间优先于规则',
    input: '明天下午3点 交周报',
    model: {
      title: '交周报',
      dueDate: '2026-11-07',
      dueTime: '16:00',
      allDay: false,
      priority: 0,
      tags: []
    },
    expected: {
      title: '交周报',
      dueDate: '2026-11-07',
      dueTime: '16:00',
      allDay: false
    }
  },
  {
    name: '模型只返回标题时补齐“每两周的周二”的 INTERVAL 与 BYDAY',
    input: '每两周的周二 复盘',
    model: { title: '复盘' },
    expected: {
      title: '复盘',
      dueDate: '2026-11-10',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'
    }
  },
  {
    name: '模型用中文写“每两周的周二”时翻译成 INTERVAL + BYDAY',
    input: '复盘',
    model: { title: '复盘', recurrence: '每两周的周二' },
    expected: {
      title: '复盘',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'
    }
  },
  {
    name: '模型漏掉“今晚/明早”时由规则补齐日期与时段',
    input: '今晚8点 看电影',
    model: { title: '看电影' },
    expected: {
      title: '看电影',
      dueDate: '2026-11-05',
      dueTime: '20:00',
      allDay: false
    }
  },
  {
    name: '模型漏掉“30分钟后”这类相对时刻时由规则补齐',
    input: '30分钟后 喝水',
    model: { title: '喝水' },
    expected: {
      title: '喝水',
      dueDate: '2026-11-05',
      dueTime: '09:30',
      allDay: false
    }
  },
  {
    name: '模型漏掉“月底”时由规则补齐月末日期',
    input: '月底 交房租',
    model: { title: '交房租' },
    expected: { title: '交房租', dueDate: '2026-11-30' }
  },
  {
    name: '模型漏掉“每个周二”时由规则补齐 BYDAY',
    input: '每个周二 晨会',
    model: { title: '晨会' },
    expected: {
      title: '晨会',
      dueDate: '2026-11-10',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU'
    }
  },
  {
    name: '模型漏掉“上周五”时由规则补齐过去的日期',
    input: '上周五 复盘',
    model: { title: '复盘' },
    expected: { title: '复盘', dueDate: '2026-10-30' }
  },
  {
    name: '模型漏掉“提醒我提前半小时”时由规则补齐提醒',
    input: '明天下午3点 提醒我提前半小时 交水电费',
    model: { title: '交水电费' },
    expected: {
      title: '交水电费',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      reminderOffsetMin: 30
    }
  }
]

function responseWith(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  } as unknown as Response
}

function statusResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body
  } as unknown as Response
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
}

function responseFor(text: string, kind: 'anthropic' | 'openai' = 'anthropic'): Response {
  if (kind === 'openai') return responseWith({ choices: [{ message: { content: text } }] })
  return responseWith({ content: [{ type: 'text', text }] })
}

async function askAi(
  input: string,
  text: string,
  options: {
    kind?: 'anthropic' | 'openai'
    maxAttempts?: number
    config?: AiConfig
  } = {}
): Promise<{
  response: Awaited<ReturnType<typeof parseQuickAddWithAi>>
  fetchImpl: ReturnType<typeof vi.fn>
}> {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    responseFor(text, options.kind)
  )
  const response = await parseQuickAddWithAi(input, LISTS, {
    config: options.config ?? CONFIG,
    now: NOW,
    fetch: fetchImpl,
    maxAttempts: options.maxAttempts ?? 1,
    retryDelayMs: 0
  })
  return { response, fetchImpl }
}

describe('AI 快速添加合并回归集', () => {
  it.each(AI_CASES)('$name', async ({ input, model, kind, expected }) => {
    const text = jsonBlock(model)
    const { response } = await askAi(input, text, { kind })
    expect(response.ok, response.warning ?? '').toBe(true)
    expect(response.source).toBe('ai')
    expect(response.warning).toBeNull()
    expect(response.attempts).toBe(1)
    expect(response.result, input).toEqual(full(expected))
  })
})

describe('AI 失败降级与请求契约回归', () => {
  it('非法 JSON 回退到规则结果并给出可操作提示', async () => {
    const input = '明天下午3点 交周报'
    const { response } = await askAi(input, '抱歉，我无法解析这句话')
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.result).toEqual(ruleQuickAdd(input, NOW))
    expect(response.warning).toContain('已按本地规则处理')
    expect(response.attempts).toBe(1)
  })

  it('取到 JSON 但没有 title 时同样回退', async () => {
    const input = '明天 复盘'
    const { response } = await askAi(input, '{"dueDate":"2026-11-06"}')
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.result).toEqual(ruleQuickAdd(input, NOW))
    expect(response.warning).toContain('已按本地规则处理')
  })

  it('只有 thinking、正文被 max_tokens 截断时提示输出预算不足', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      responseWith({
        stop_reason: 'max_tokens',
        content: [{ type: 'thinking', thinking: '先分析一下……' }]
      })
    )
    const input = '明天 复盘'
    const response = await parseQuickAddWithAi(input, LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.result).toEqual(ruleQuickAdd(input, NOW))
    expect(response.warning).toContain('推理过程')
    expect(response.attempts).toBe(1)
  })
})

describe('AI 重试与请求契约回归', () => {
  it('401 不重试，提示检查 Token', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      statusResponse(401, 'Unauthorized')
    )
    const response = await parseQuickAddWithAi('明天 复盘', LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 2,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.warning).toContain('鉴权')
    expect(response.attempts).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('500 自动重试一次后成功，attempts 回报 2', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1
      if (calls === 1) return statusResponse(500, 'upstream error')
      return responseFor(jsonBlock({ title: '复盘', dueDate: '2026-11-06' }))
    })
    const response = await parseQuickAddWithAi('明天 复盘', LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 2,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(true)
    expect(response.attempts).toBe(2)
    expect(response.result).toEqual(full({ title: '复盘', dueDate: '2026-11-06' }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('连接失败重试后仍失败，提示服务地址与重试次数', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:15721')
    })
    const response = await parseQuickAddWithAi('明天 复盘', LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 2,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.warning).toContain('连接不上 AI 服务（127.0.0.1:15721）')
    expect(response.warning).toContain('已自动重试 1 次')
    expect(response.attempts).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('超时提示秒数且不重试', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('AI 请求超时')
      error.name = 'AbortError'
      throw error
    })
    const response = await parseQuickAddWithAi('明天 复盘', LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 2,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.warning).toContain('AI 请求超时（15 秒）')
    expect(response.attempts).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('AI 开关与请求契约回归', () => {
  it('空输入不发请求，attempts 为 0', async () => {
    const fetchImpl = vi.fn(async () => responseFor(jsonBlock({ title: 'x' })))
    const response = await parseQuickAddWithAi('   ', LISTS, {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.warning).toBe('输入为空')
    expect(response.attempts).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('关闭 AI 时不发请求，直接走规则', async () => {
    const fetchImpl = vi.fn(async () => responseFor(jsonBlock({ title: 'x' })))
    const response = await parseQuickAddWithAi('明天 复盘', LISTS, {
      config: { ...CONFIG, enabled: false },
      now: NOW,
      fetch: fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    })
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.warning).toContain('AI 已关闭')
    expect(response.attempts).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('只请求本机 127.0.0.1:15721，模型名与默认目录逐字一致', async () => {
    const { fetchImpl } = await askAi(
      '明天下午3点交周报',
      jsonBlock({ title: '交周报', dueDate: '2026-11-06' })
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${AI_DEFAULT_BASE_URL}/v1/messages`)
    const body = JSON.parse(String(init?.body)) as {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe(AI_DEFAULT_MODEL)
    expect(body.max_tokens).toBe(AI_QUICK_ADD_MAX_TOKENS)
    expect(body.system).toContain('TickFlow')
    expect(body.messages[0].content).toContain('明天下午3点交周报')
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.authorization).toBeUndefined()
  })
})
