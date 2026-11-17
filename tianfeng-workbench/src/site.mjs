// 「自有站点」接口（可选）：你自己的课程站 / 会员站。不配 config.site 就整块关掉——
// 不建课、不采站点流量和注册，网页上也不显示站点那一格和「转化」页。
//
// 站点需要提供两个接口（用浏览器里管理员登录态去调，天锋不存密码）：
//   coursesApi   GET → { courses: [{ _id, title, seriesId, visibilityStatus: 'published'|..., viewCount, publishedAt }] }
//   dashboardApi GET → { funnel: { totalRegistered }, registrationTrend: [{ date, count, vipCount }], revenueTrend: [{ date, count, revenue }],
//                        channelStats: [{ source, registeredCount, vipCount, orderCount, revenue }], campaignStats?: [{ campaign, sources, ... }] }
// 建课（上传成片）走发布插件里的站点适配器。
import { config } from './feishu.mjs';

const S = config.site && config.site.base ? config.site : null;
export const SITE = S && {
  name: S.name || '知识站',
  base: S.base.replace(/\/$/, ''),
  admin: S.base.replace(/\/$/, '') + (S.adminPath || '/admin'),
  coursesApi: S.coursesApi || '/api/courses?admin=1',
  dashboardApi: S.dashboardApi || '/api/admin/dashboard',
  courseUrl: (c) => S.base.replace(/\/$/, '') + (S.coursePath || '/series/{seriesId}?courseId={id}').replace('{seriesId}', c.seriesId).replace('{id}', c.id || c._id),
};
