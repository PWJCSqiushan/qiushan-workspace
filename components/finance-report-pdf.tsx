import React from 'react';
import { Document, Page, View, Text, Svg, Path, Circle, Line, Rect, Font, pdf } from '@react-pdf/renderer';
import type { FinanceReport, ReportGroup } from '../lib/finance-report-data';

const ink = '#263e48', muted = '#647781', rule = '#dce6e4';
export const reportMoney = (cents: number) => '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (cents: number, base: number) => base > 0 ? (cents / base * 100).toFixed(1) + '%' : '—';
const short = (s: string, n: number) => Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join('') + '…' : s;
const dayBefore = (to: string) => new Date(Date.parse(to + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const generated = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Preserve special entries, bound the legend, and keep every cent in the sum. */
function smallGroups(groups: ReportGroup[]) {
  const positive = groups.filter(g => g.cents > 0).sort((a, b) => b.cents - a.cents);
  const special = positive.filter(g => /未细分|待分类/.test(g.name));
  const normal = positive.filter(g => !special.includes(g));
  const capacity = 6 - special.length;
  if (normal.length <= capacity) return [...normal, ...special];
  const head = normal.slice(0, Math.max(0, capacity - 1));
  return [...head, { id: '__other__', name: '其他次用途', cents: normal.slice(head.length).reduce((s, g) => s + g.cents, 0), color: '#c2cbcc', children: [] }, ...special];
}
function ringPath(start: number, end: number, r = 88, inner = 64) {
  const point = (radius: number, angle: number) => `${100 + radius * Math.cos(angle)},${100 + radius * Math.sin(angle)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M${point(r, start)} A${r},${r} 0 ${large} 1 ${point(r, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}
function Ring({ groups, size, cents, caption }: { groups: { cents: number; color: string }[]; size: number; cents: number; caption: string }) {
  const total = groups.reduce((s, g) => s + Math.max(0, g.cents), 0);
  const positive = groups.filter(g => g.cents > 0);
  return <View style={{ width: size, height: size, position: 'relative' }}>
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx={100} cy={100} r={76} stroke="#edf1f0" strokeWidth={24} fill="none" />
      {positive.map((g, i) => {
        const start = -Math.PI / 2 + positive.slice(0, i).reduce((s, item) => s + item.cents, 0) / total * Math.PI * 2;
        const angle = start + g.cents / total * Math.PI * 2;
        // Two arcs avoid the SVG coincident-endpoint case for a full ring.
        return g.cents === total ? <Circle key={i} cx={100} cy={100} r={76} stroke={g.color} strokeWidth={24} fill="none" /> : <Path key={i} d={ringPath(start, angle)} fill={g.color} />;
      })}
    </Svg>
    <View style={{ position: 'absolute', top: size * .40, left: size * .14, width: size * .72, textAlign: 'center' }}>
      <Text style={{ fontSize: size > 150 ? 19 : 9.5, color: ink }}>{reportMoney(cents)}</Text>
      <Text style={{ fontSize: size > 150 ? 9.5 : 8, color: muted, marginTop: 3 }}>{caption}</Text>
    </View>
  </View>;
}
function Header({ report, title, page }: { report: FinanceReport; title: string; page: number }) {
  return <View style={{ position: 'absolute', top: 24, left: 26, right: 26, height: 43, borderBottomWidth: 1, borderBottomColor: rule }}>
    <Text style={{ fontSize: 21, color: ink }}>{title}</Text>
    <Text style={{ position: 'absolute', top: 5, right: 0, fontSize: 10, color: muted }}>生活账本 / {report.space === 'demo' ? '演示' : '个人'} · 人民币 CNY</Text>
    <Text style={{ marginTop: 4, fontSize: 9.5, color: muted }}>{report.from} 至 {dayBefore(report.to)}（含结束日）{report.localDraft ? ` · 含 ${report.pendingCount} 笔本地草稿` : ' · 已确认快照'}</Text>
    <Text style={{ position: 'absolute', top: 30, right: 0, fontSize: 8, color: muted }}>生成 {generated(report.generatedAt)}（上海） · 版本 {report.snapshotVersion} · {page}/2</Text>
  </View>;
}
function Footer({ page }: { page: number }) {
  return <View style={{ position: 'absolute', top: 551, left: 26, right: 26, borderTopWidth: 1, borderTopColor: rule, paddingTop: 7 }}>
    <Text style={{ fontSize: 8, color: muted }}>口径：AA按本人承担，用途按分摊计；已知退款回溯原消费日。转账及往来不计消费/收入；历史分析记录不改变账户资金。</Text>
    <Text style={{ fontSize: 8, color: muted, marginTop: 3 }}>消费记录笔数按交易去重；图形只画正向金额，负数调整另列。报告包含摘要和重点明细。　　　　　　　　　　　　　　　　　{page} / 2</Text>
  </View>;
}
function Trend({ report }: { report: FinanceReport }) {
  const rows = report.trend, width = 756, height = 55;
  const actualMax = Math.max(0, ...rows.map(r => Math.abs(r.cents)));
  const max = Math.max(1, actualMax);
  const hasNegative = rows.some(r => r.cents < 0), zeroY = hasNegative ? height / 2 : height;
  const stride = width / Math.max(1, rows.length);
  return <View style={{ position: 'absolute', top: 373, left: 34, right: 34 }}>
    <Text style={{ fontSize: 11, marginBottom: 6 }}>消费趋势 · 按{report.trendUnit === 'day' ? '日' : report.trendUnit === 'week' ? '周' : '月'}汇总</Text>
    <Svg width={width} height={height + 8} viewBox={`0 0 ${width} ${height + 8}`}>
      <Line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke={rule} strokeWidth={1} />
      {rows.map((r, i) => {
        const h = Math.abs(r.cents) / max * (hasNegative ? height / 2 : height - 2), x = i * stride + stride * .15;
        return !r.recorded ? <Circle key={i} cx={x + stride * .35} cy={zeroY} r={1.8} stroke="#b2bfbe" fill="white" /> : r.cents === 0 ? <Circle key={i} cx={x + stride * .35} cy={zeroY} r={2} fill="#3e9080" /> : <Rect key={i} x={x} y={r.cents > 0 ? zeroY - h : zeroY} width={Math.max(.5, stride * .70)} height={h} fill={r.cents < 0 ? '#b68074' : '#79bba6'} />;
      })}
    </Svg>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: muted }}>
      <Text>{report.from}</Text><Text>实点：已记录零消费　空心点：无消费记录　最大绝对金额 {reportMoney(actualMax)}</Text><Text>{dayBefore(report.to)}</Text>
    </View>
  </View>;
}
function PurposeCard({ group, rank, report, width }: { group: ReportGroup; rank: number; report: FinanceReport; width: number }) {
  const children = smallGroups(group.children), negative = group.children.filter(g => g.cents < 0), childPositive = children.reduce((s, g) => s + g.cents, 0);
  return <View wrap={false} style={{ width, height: 210, borderWidth: 1, borderColor: rule, borderRadius: 5, padding: 12 }}>
    <Text style={{ fontSize: 11, color: ink, height: 30 }}>{rank.toString().padStart(2, '0')}　{short(group.name, 28)}</Text>
    <Text style={{ fontSize: 10, color: muted, marginBottom: 8 }}>{reportMoney(group.cents)} · 占净消费 {percent(group.cents, report.personalCents)}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Ring groups={children} size={104} cents={group.cents} caption="该用途净额" />
      <View style={{ flex: 1, marginLeft: 8 }}>
        {children.map(g => <View key={g.id} style={{ marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', height: 21 }}><View style={{ width: 5, height: 5, backgroundColor: g.color, marginTop: 3, marginRight: 4 }} /><Text style={{ fontSize: 9, lineHeight: 1.1, width: 57 }}>{short(g.name, 12)}</Text><View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={{ fontSize: 8.5 }}>{reportMoney(g.cents)}</Text><Text style={{ fontSize: 8, color: muted }}>{percent(g.cents, group.cents)}</Text></View></View>
        </View>)}
        {!children.length && <Text style={{ fontSize: 9, color: muted }}>尚未细分</Text>}
      </View>
    </View>
    <Text style={{ position: 'absolute', bottom: 9, left: 12, right: 12, fontSize: 8, color: muted }}>{negative.length ? `负数调整 ${reportMoney(negative.reduce((s, g) => s + g.cents, 0))}；环图基数 ${reportMoney(childPositive)}。` : children.length === 1 && /未细分/.test(children[0].name) ? '尚未细分；百分比以本用途合计为分母。' : '图例百分比以该一级用途净额为分母。'}</Text>
  </View>;
}
function DetailCard({ report, width }: { report: FinanceReport; width: number }) {
  return <View wrap={false} style={{ width, height: 210, borderWidth: 1, borderColor: rule, borderRadius: 5, padding: 12 }}>
    <Text style={{ fontSize: 11, marginBottom: 4 }}>重点明细 · 本人净额 TOP 5</Text>
    <Text style={{ fontSize: 8, color: muted, marginBottom: 8 }}>日期 / 商户或说明 / 用途 / 退款后净额</Text>
    {report.details.map((d, i) => <View key={d.id} style={{ paddingVertical: 5, borderTopWidth: 1, borderTopColor: rule }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 9 }}>{i + 1}　{d.date}</Text><Text style={{ fontSize: 9 }}>{reportMoney(d.cents)}</Text></View>
      <Text style={{ fontSize: 9, marginTop: 2 }}>{short(d.description, 13)} · {short(d.purpose, 8)}</Text>
    </View>)}
    {!report.details.length && <Text style={{ fontSize: 10, color: muted, marginTop: 28 }}>此范围无净额为正的消费明细。</Text>}
  </View>;
}
export function FinanceReportDocument({ report }: { report: FinanceReport }) {
  const negative = report.adjustments.reduce((s, g) => s + g.cents, 0), top = report.topGroups[0], topFive = report.topGroups.reduce((s, g) => s + g.cents, 0);
  const count = report.topGroups.length + 1, columns = count <= 2 ? count : 3, cardWidth = (788 - (columns - 1) * 10) / columns;
  const pageStyle = { fontFamily: 'QiushanReport', fontSize: 9.5, color: ink, backgroundColor: '#fdfefd', height: 595.28, width: 841.89 };
  return <Document title="生活账本消费报告" author="丘山个人工作台" language="zh-CN">
    <Page size="A4" orientation="landscape" wrap={false} style={pageStyle}>
      <View style={{ height: 595.28 }} />
      <Header report={report} title="消费总览" page={1} />
      <View style={{ position: 'absolute', top: 81, left: 26, right: 26, flexDirection: 'row' }}>
        {[
          ['本人净消费', reportMoney(report.personalCents)], ['真实收入', reportMoney(report.incomeCents)], ['消费记录笔数', String(report.expenseCount)], ['待分类金额', reportMoney(report.unclassifiedCents)],
        ].map(([label, value], i) => <View key={label} style={{ width: '25%', paddingLeft: i ? 18 : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: rule }}><Text style={{ color: muted, fontSize: 9.5 }}>{label}</Text><Text style={{ fontSize: 22, marginTop: 3 }}>{value}</Text></View>)}
      </View>
      <View style={{ position: 'absolute', top: 148, left: 26, right: 26, flexDirection: 'row', alignItems: 'center' }}>
        <Ring groups={report.overviewGroups} size={212} cents={report.personalCents} caption="本人净消费" />
        <View style={{ marginLeft: 32, flex: 1 }}>
          <Text style={{ fontSize: 12, marginBottom: 5 }}>主要用途 · 一级分类</Text>
          <Text style={{ fontSize: 8.5, color: muted, marginBottom: 9 }}>金额 / 占正向用途合计 {reportMoney(report.positiveCents)} 的比例</Text>
          {report.overviewGroups.map(g => <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
            <View style={{ width: 7, height: 7, backgroundColor: g.color, marginRight: 9 }} /><Text style={{ fontSize: 10, width: 265 }}>{short(g.name, 26)}</Text><Text style={{ fontSize: 10, width: 118, textAlign: 'right' }}>{reportMoney(g.cents)}</Text><Text style={{ fontSize: 10, flex: 1, textAlign: 'right', color: muted }}>{percent(g.cents, report.positiveCents)}</Text>
          </View>)}
          {!report.overviewGroups.length && <Text style={{ color: muted, marginVertical: 20 }}>此范围没有正向用途金额。</Text>}
          <Text style={{ marginTop: 3, fontSize: 8.5, color: muted }}>正向用途 {reportMoney(report.positiveCents)} + 负数调整 {reportMoney(negative)} = 净消费 {reportMoney(report.personalCents)}</Text>
          {report.adjustments.length > 0 && <Text style={{ marginTop: 4, fontSize: 8.5, color: muted }}>调整项：{short(report.adjustments.map(g => `${g.name} ${reportMoney(g.cents)}`).join('；'), 95)}</Text>}
        </View>
      </View>
      <Trend report={report} />
      <View style={{ position: 'absolute', top: 500, left: 34, right: 34, fontSize: 9.5, lineHeight: 1.5 }}>
        <Text>{top ? `最大主要用途为${short(top.name, 24)}，净额 ${reportMoney(top.cents)}，占净消费 ${percent(top.cents, report.personalCents)}。前五个主要用途净额合计占净消费 ${percent(topFive, report.personalCents)}。` : '此范围尚无净额为正的已分类主要用途。'}</Text>
        <Text>待分类净额 {reportMoney(report.unclassifiedCents)}{negative < 0 ? '；负数调整已单列，构成图仅表示正向金额。' : '，已包含在本人净消费中。'}</Text>
      </View>
      <Footer page={1} />
    </Page>
    <Page size="A4" orientation="landscape" wrap={false} style={pageStyle}>
      <View style={{ height: 595.28 }} />
      <Header report={report} title="重点用途展开" page={2} />
      <Text style={{ position: 'absolute', top: 79, left: 26, fontSize: 9, color: muted }}>按一级用途净消费排序；图例金额以元展示。长名称/说明适度截短，完整流水可另导出 CSV。</Text>
      <View style={{ position: 'absolute', top: 103, left: 26, right: 26, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {report.topGroups.map((g, i) => <PurposeCard key={g.id} group={g} rank={i + 1} report={report} width={cardWidth} />)}
        <DetailCard report={report} width={cardWidth} />
      </View>
      <Footer page={2} />
    </Page>
  </Document>;
}
let fontSource = '';
export function registerReportFont(src: string) {
  if (src === fontSource) return;
  Font.register({ family: 'QiushanReport', src });
  Font.registerHyphenationCallback(word => Array.from(word));
  fontSource = src;
}
export async function renderFinanceReport(report: FinanceReport, origin: string) {
  registerReportFont(new URL('/fonts/QiushanReportSans-Regular.ttf', origin).href);
  return pdf(<FinanceReportDocument report={report} />).toBlob();
}
