# Audit 03 — `metap-demo-waf`'s component placement vs. design-system/platform-ui (2026-09-05)

Thực hiện theo `../../../metap-docs/docs/features/25-audit-waf-demo-component-placement.md` — kiểm
tra `metap-demo-waf/data-plane/web` (app downstream mới nhất, build từ 2026-09-01) có tuân thủ
đúng rule "UI → `@metap/ui`, UI+logic dùng lại được → `@metap/platform-ui`" hay không. Chưa từng có
audit nào cho riêng 1 consumer app cụ thể trước đây (`docs/frontend-checklist.md`'s rà soát
2026-09-04 tự ghi rõ điều này). Chỉ report — không sửa code.

**Phạm vi đã quét: 23/23 file `.ts`/`.tsx` dưới `data-plane/web/src/`** (đếm bằng `git ls-files
'src/*.ts' 'src/*.tsx' | wc -l` = 23), đọc toàn bộ từng file, không sample:
`App.tsx`, `main.tsx`, `api/waf.ts`, `components/primitives.tsx`, `demo/EntitiesPage.tsx`,
`demo/LoginPage.tsx`, `i18n/register.ts`, `i18n/resources.ts` (chuỗi dịch thuần, không có
component/JSX nào — loại khỏi phạm vi phân loại bên dưới một cách có chủ đích, không phải bỏ sót),
`pages/AlertingPage.tsx`, `pages/AnalyticsPage.tsx`, `pages/DashboardPage.tsx`,
`pages/FindingsPage.tsx`, `pages/IncidentDetailPage.tsx`, `pages/IncidentsPage.tsx`,
`pages/OnboardingPage.tsx`, `pages/SettingsPage.tsx`, `pages/ZoneDetailPage.tsx`,
`pages/ZonesPage.tsx`, `pages/zone/ZoneDdosTab.tsx`, `pages/zone/ZoneEventsTab.tsx`,
`pages/zone/ZoneOverviewTab.tsx`, `pages/zone/ZoneRulesTab.tsx`, `pages/zone/ZoneScansTab.tsx`.

Phương pháp: đọc trực tiếp source từng file (không skim), đối chiếu ngược với
`platform-ui/src/**` và `design-system/src/components/*` để biết cái gì đã tồn tại rồi (tránh đề
xuất "tạo mới" cái đã có sẵn), và `grep` toàn bộ `import ... from "..."` để dựng danh sách đầy đủ
mọi package ngoài được import (nhóm 4 dưới đây dựa trên danh sách đó, không phải ấn tượng).

**Không cần vòng verify độc lập kiểu Phase 41**: dù tổng 8 finding thật (nhóm 1: 5, nhóm 2: 2,
nhóm 3 có tranh cãi: 1) không nhỏ, mỗi finding đều đã tự verify bằng `grep -rln` đếm chính xác số
chỗ dùng + đọc trực tiếp từng chỗ dùng đó (không suy đoán từ 1 mẫu) — xem cột "Bằng chứng" ở mỗi
mục. Không có finding nào chỉ dựa trên 1 lần đọc lướt.

## Tóm tắt

| #     | Nhóm                                               | Vị trí                                                                     | Vấn đề                                                                                                                                                                         | Số chỗ dùng |
| ----- | -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1     | **Nên chuyển `@metap/ui`**                         | `components/primitives.tsx:12-34` (`PageHeader`)                           | Tiêu đề trang + mô tả + action slot — không biết business, giống hệt shape 1 page-header atom chuẩn                                                                            | 10          |
| 2     | **Nên chuyển `@metap/ui`**                         | `components/primitives.tsx:129-147` (`EmptyState`)                         | Title/description/action — không 1 chữ nào biết WAF là gì                                                                                                                      | 10          |
| 3     | **Nên chuyển `@metap/ui`**                         | `components/primitives.tsx:149-178` (`SectionCard`)                        | `Card` + header (title/description/actions) + children — bố cục thuần, dùng lại được ở bất kỳ app nào                                                                          | 12          |
| 4     | **Nên chuyển `@metap/ui`**                         | `components/primitives.tsx:36-78` (`StatTile`)                             | Label/value/hint/tone/loading — không field WAF nào trong props                                                                                                                | 4           |
| 5     | **Nên chuyển `@metap/ui`**                         | `components/primitives.tsx:187-278` (`TimeSeries`)                         | Line/area chart inline SVG, tự nhận là cùng lý do & cách làm với `@metap/ui`'s `BarChart` (đọc doc-comment file gốc) — thiếu đúng 1 chart-kind design-system chưa có           | 3           |
| 6     | **Nên chuyển `@metap/platform-ui`**                | 9 file, 18 chỗ (danh sách dưới)                                            | Pattern `setBusy(true) → try { await action(); invalidate(); toast(success) } catch { toast(error) } finally { setBusy(false) }` lặp lại gần như byte-for-byte                 | 18          |
| 7     | **Nên chuyển `@metap/platform-ui`**                | `pages/ZoneDetailPage.tsx:191-213`, `pages/IncidentDetailPage.tsx:148-170` | `Dialog`+`DialogTrigger`(nút "workflow.visualize")+`DialogContent`+`DialogHeader`+`WorkflowDiagram` — cùng 1 khối lặp verbatim                                                 | 2           |
| 8     | **Giữ nguyên, có ghi chú 2 chiều**                 | `components/primitives.tsx:80-127` (`StatusBadge`/`TONES`)                 | Bản thân data (`TONES`) là từ vựng WAF thật — giữ đúng; nhưng cơ chế nó lấp (map giá trị enum → tone ngữ nghĩa) là 1 gap thật của `platform-ui/src/field/FieldValue.tsx:75-77` | 13          |
| —     | Nhóm 4 (vi phạm import trực tiếp)                  | —                                                                          | **Không có finding nào** — xem "Đã verify sạch"                                                                                                                                | 0           |
| (phụ) | Nên chuyển `@metap/platform-ui` (mức ưu tiên thấp) | `components/primitives.tsx:282-299` (`shortDate`/`dayLabel`)               | Format ngày thuần, không phải component/JSX, không WAF-specific — rẻ nên chưa chắc đáng chuyển ngay                                                                            | 8 + 3       |

---

## 1-4. Bốn primitive thuần trình bày trong `components/primitives.tsx`

**`PageHeader`** (dòng 12-34), **`EmptyState`** (129-147), **`SectionCard`** (149-178),
**`StatTile`** (36-78) — cả 4 nhận props hoàn toàn generic (`title`/`description`/`actions`,
`label`/`value`/`hint`/`tone`/`loading`, `children`), không field nào biết `Zone`/`Incident`/WAF là
gì. File tự ghi chú lý do để ở app (dòng 1-7): _"encodes a WAF domain vocabulary... Anything here
that turns out to be domain-free is a candidate to move later, once a second app wants it."_ — 4
component này chính là phần đã tự nhận domain-free đó.

**Bằng chứng số chỗ dùng** (`grep -rln`, không tính chính `primitives.tsx`):

- `PageHeader`: 10 file (`SettingsPage`/`AnalyticsPage`/`DashboardPage`/`FindingsPage`/
  `ZoneDetailPage`/`IncidentsPage`/`OnboardingPage`/`AlertingPage`/`ZonesPage`/`IncidentDetailPage`)
- `EmptyState`: 10 file
- `SectionCard`: 12 file
- `StatTile`: 4 file (`DashboardPage`/`AnalyticsPage`/`FindingsPage`/`ZoneOverviewTab`)

**Đối chiếu đã có gì ở design-system/platform-ui**: không có — `design-system/src/components/`
không có folder nào tên `page-header`/`empty-state`/`section-card`/`stat-tile`, và
`platform-ui/src` không có component nào tên tương đương (`grep` xác nhận 0 kết quả). Đây là 4 gap
thật, không phải trùng lặp cái đã tồn tại. `GeneratedList.tsx` (`platform-ui`) hiện tự render empty
state bằng 1 dòng text giữa ô bảng thay vì 1 component dùng chung — nếu `EmptyState` chuyển lên
`@metap/ui`, `platform-ui` cũng có thể tận dụng ngược, không chỉ WAF.

**Khuyến nghị**: cả 4 đủ điều kiện chuyển `@metap/ui` — tổng quát thật (không cast rộng ra từ 1
use-case), lặp lại thật (4-12 chỗ, vượt xa ngưỡng "1 chỗ dùng chưa đáng chuyển"). Không tự sửa
trong audit này (đúng phạm vi) — cần 1 feature brief riêng nếu chủ dự án đồng ý, do `StatTile`/
`SectionCard` phụ thuộc `Card`/`CardContent`/`Skeleton` đã có sẵn nên việc chuyển gần như chỉ là
di chuyển file + đổi import, rủi ro thấp.

## 5. `TimeSeries` — thiếu đúng 1 chart-kind so với `BarChart` đã có

`components/primitives.tsx:187-278`. Tự nhận trong doc-comment (dòng 180-185): _"Inline SVG, no
chart library — the same call `@metap/ui`'s own `BarChart` made, and for the same reason."_ Đọc
`design-system/src/components/bar-chart/bar-chart.tsx` xác nhận đúng: cùng cách đọc màu từ CSS
token (`hsl(var(--primary))`), cùng lý do "1 series không đáng thêm dependency". `TimeSeries` là
line/area chart — 1 chart-kind design-system **chưa có** (chỉ có `bar-chart`), không phải trùng lặp.

**Số chỗ dùng**: 3 (`DashboardPage.tsx`, `AnalyticsPage.tsx`, `ZoneOverviewTab.tsx`) — dưới ngưỡng
">=2" một chút nhưng đã lặp thật (không phải 1 chỗ), và nhất quán triết lý "no chart library" đã
có tiền lệ ở `BarChart`.

**Khuyến nghị**: candidate hợp lý cho `@metap/ui`, cùng mức ưu tiên như nhóm 1-4, nhưng cân nhắc
gộp chung 1 feature brief với nhóm 1-4 (cùng file nguồn, cùng người sẽ review).

## 6. Pattern "busy + try/catch/finally + toast" lặp lại 18 lần / 9 file

**Không 1 chữ WAF nào trong pattern này** — thuần "gọi 1 async action, disable nút lúc chạy, báo
lỗi qua toast nếu fail". Đọc trực tiếp từng chỗ xác nhận cùng shape byte-for-byte (chỉ khác action
gọi bên trong):

```tsx
setBusy(true);
try {
  await someAction(...);
  invalidate();
  toast(t("..."), { variant: "default" }); // không phải chỗ nào cũng có dòng success-toast
} catch (e) {
  toast(e instanceof Error ? e.message : String(e), { variant: "destructive" });
} finally {
  setBusy(false);
}
```

**18 chỗ, theo file:dòng đã đọc trực tiếp**:

| File                           | Hàm           | Dòng    |
| ------------------------------ | ------------- | ------- |
| `pages/AlertingPage.tsx`       | `save`        | 103-134 |
| `pages/AlertingPage.tsx`       | `sendTest`    | 136-161 |
| `pages/AlertingPage.tsx`       | `evaluateNow` | 163-184 |
| `pages/SettingsPage.tsx`       | `save`        | 49-79   |
| `pages/SettingsPage.tsx`       | `reset`       | 81-98   |
| `pages/FindingsPage.tsx`       | `act`         | 89-106  |
| `pages/IncidentsPage.tsx`      | `advance`     | 74-93   |
| `pages/IncidentsPage.tsx`      | `correlate`   | 95-116  |
| `pages/IncidentDetailPage.tsx` | `advance`     | 100-120 |
| `pages/ZoneDetailPage.tsx`     | `act`         | 113-131 |
| `pages/zone/ZoneDdosTab.tsx`   | `save`        | 53-76   |
| `pages/zone/ZoneDdosTab.tsx`   | `remove`      | 78-94   |
| `pages/zone/ZoneRulesTab.tsx`  | `save`        | 106-140 |
| `pages/zone/ZoneRulesTab.tsx`  | `remove`      | 142-156 |
| `pages/zone/ZoneRulesTab.tsx`  | `move`        | 160-183 |
| `pages/zone/ZoneScansTab.tsx`  | `createJob`   | 84-98   |
| `pages/zone/ZoneScansTab.tsx`  | `run`         | 100-115 |
| `pages/zone/ZoneEventsTab.tsx` | `correlate`   | 56-75   |

(`pages/OnboardingPage.tsx`'s `guard()` helper, dòng 75-85, là 1 biến thể nhẹ hơn — dùng `error`
state thay vì `toast`, không đếm trùng vào 18 ở trên, nhưng cùng họ pattern, nên nếu làm feature
này thì `OnboardingPage` cũng nên đổi theo cho nhất quán.)

**Đối chiếu platform-ui**: không có hook nào tên `useAsyncAction`/tương đương trong
`platform-ui/src`. `useApiMutation` (React Query) đã giải quyết đúng vấn đề này cho mutation qua
REST — nhưng 15/18 chỗ trên gọi hàm imperative trong `api/waf.ts` (GraphQL qua `graphqlAuthed`,
không phải hook), nên không thể thay bằng `useApiMutation` thẳng mà không đổi kiến trúc data layer
của cả app trước — **đây là lý do thật khiến pattern này KHÔNG tự dùng lại được `useApiMutation`
sẵn có, chứ không phải do tác giả không biết nó tồn tại**.

**Khuyến nghị**: 1 hook nhỏ `useAsyncAction()` ở `@metap/platform-ui` (nhận 1 async fn, trả về
`{run, busy}`, tự bọc try/catch/finally + optionally toast) sẽ dùng được ngay cho pattern trên mà
không cần đổi transport GraphQL/REST gì cả — độc lập với `useApiMutation`, bổ sung chứ không thay
thế nó.

## 7. `WorkflowDiagram` dialog wrapper lặp verbatim 2 lần

`pages/ZoneDetailPage.tsx:191-213` và `pages/IncidentDetailPage.tsx:148-170` — cùng structure
`Dialog > DialogTrigger(asChild, Button "workflow.visualize") > DialogContent(max-w-3xl) >
DialogHeader > DialogTitle > WorkflowDiagram(...)`, chỉ khác props truyền vào `WorkflowDiagram`.
Cả 2 file đều đã import `WorkflowDiagram` trực tiếp từ `@metap/platform-ui` — đúng chỗ, chỉ có lớp
Dialog bọc ngoài là lặp.

**Khuyến nghị**: mức ưu tiên thấp hơn #6 (chỉ 2 chỗ, đúng ngưỡng tối thiểu "đã lặp lại", không phải
1 chỗ) — 1 component tiện ích nhỏ `WorkflowVisualizeDialog` (nhận đúng những prop `WorkflowDiagram`
cần + `label`) ở `@metap/platform-ui` sẽ xoá lặp này, nhưng không khẩn — ghi nhận để tự quyết định,
đúng tinh thần "1 chỗ dùng chưa chắc đáng chuyển ngay" (ở đây là 2, biên giới mờ).

## 8. `StatusBadge`/`TONES` — giữ nguyên, nhưng có 1 gap thật đáng nói 2 chiều

`components/primitives.tsx:80-127`. Bản thân `TONES` (dòng 82-117: `active`→`default`,
`blocked`→`destructive`, `critical`→`destructive`, `resolved`→`default`, ...) là từ vựng nghiệp vụ
WAF/enum của các entity cụ thể — **đúng khi giữ tại app**, một `@metap/ui` tổng quát không được
biết "blocked" nghĩa là gì.

Nhưng đọc `platform-ui/src/field/FieldValue.tsx:75-77` (cách `platform-ui` tự render field kind
`enum` trong `GeneratedList`/`RecordDetail` sẵn có):

```tsx
if (field.kind === "enum") {
  return <Badge variant="secondary">{formatted}</Badge>;
}
```

— mọi giá trị enum, dù là "active" hay "failed" hay "critical", đều ra `variant="secondary"` như
nhau, không map theo ngữ nghĩa giá trị. `StatusBadge` của WAF làm đúng thứ `FieldValue` chưa làm
(tone theo giá trị + fallback i18n `waf.status.<value>`). Đây không phải lỗi của WAF — WAF không
sai khi tự viết `StatusBadge` cho chính nhu cầu của nó — nhưng là tín hiệu thật rằng **cơ chế**
"tone theo giá trị enum" là 1 khả năng chung đáng có ở tầng `platform-ui` (ví dụ 1
`FieldDisplayHint` mới kiểu `enumTones: Record<string, BadgeVariant>` khai báo phía metadata, để
`FieldValue` tự áp dụng), không chỉ ở WAF.

**Không đề xuất chuyển `StatusBadge`/`TONES` sang platform-ui** (data là của WAF) — chỉ ghi nhận
gap ở `FieldValue.tsx` như 1 hạt giống cho 1 feature brief riêng nếu chủ dự án thấy đáng làm; không
tự quyết định nó có đáng làm hay không (2 chiều lập luận, đúng rủi ro brief đã lường trước).

**Số chỗ dùng `StatusBadge`**: 13 file (không tính `i18n/resources.ts`, nơi `waf.status.*` là data
dịch chứ không phải import component).

## (Phụ) `shortDate`/`dayLabel` — utility thuần, ưu tiên thấp

`components/primitives.tsx:280-299`. Không phải component/JSX, là 2 hàm format ngày thuần
(`shortDate` dùng 8 file, `dayLabel` dùng 3 file), không có từ vựng WAF nào. Về mặt kỹ thuật đủ
điều kiện nhóm 2 (`@metap/platform-ui`, cạnh `i18n/useEntityLabels.ts` chẳng hạn), nhưng bản thân
rất rẻ (2 hàm ngắn, 0 phụ thuộc ngoài `Date` built-in) — trừng phạt chi phí di chuyển (thêm 1 export
public, 1 điểm phối hợp version) có thể không đáng so với lợi ích. Ghi nhận, không đề xuất ưu tiên.

---

## Đã verify sạch (không phải finding)

- **Nhóm 4 hoàn toàn sạch**: `grep` toàn bộ `import ... from "..."` trên cả 23 file chỉ ra đúng 6
  nguồn ngoài `@metap/ui`/`@metap/platform-ui`/relative-import: `react`, `react-dom/client`,
  `react-i18next`, `react-router-dom`, `@tanstack/react-query` — không có Radix trần, không icon
  lib riêng, không CSS-in-JS/CSS module nào. Không có `<svg>` hand-rolled nào ngoài
  `primitives.tsx`'s `TimeSeries` (đã xử lý ở finding #5) — không có icon SVG rải rác kiểu
  `platform-ui` hay làm (đây là khác biệt phong cách, không phải vi phạm — WAF chưa cần icon rời).
- **`api/waf.ts`**: toàn bộ logic (GraphQL query building, entity field caching, reshaping) đúng
  chỗ tại app — không 1 dòng nào thuộc về `platform-ui`, mọi thứ đặc thù cấu trúc entity/schema của
  chính app này qua `waf-graphql-gateway`.
- **`ZonesPage.tsx`/`OnboardingPage.tsx`/nhiều trang khác** cố ý không dùng `GeneratedList`/
  `GeneratedForm` — có lý do kiến trúc thật ghi ngay trong doc-comment đầu file (zone row cần
  derived state, onboarding là 1 flow 5 bước không phải CRUD phẳng), không phải bỏ qua platform-ui
  vì không biết nó tồn tại — cả 2 trang vẫn import `@metap/ui`/`@metap/platform-ui` cho mọi atom.

## Kết luận

8 finding thật (5 nhóm 1, 2 nhóm 2 rõ ràng + 1 nhóm 2 mức thấp, 1 nhóm 3 có ghi chú 2 chiều), 0
finding nhóm 4. Không có thay đổi code nào trong audit này — quyết định làm feature nào, theo thứ
tự nào, là của chủ dự án; feature brief riêng nên tách nhóm 1 (di chuyển primitive, rủi ro thấp)
khỏi nhóm 2 (`useAsyncAction`, cần thiết kế API hook cẩn thận hơn) nếu được duyệt.
