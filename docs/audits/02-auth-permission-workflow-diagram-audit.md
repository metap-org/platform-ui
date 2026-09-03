# Audit 02 — Luồng login/phân quyền & `WorkflowDiagram` (2026-09-02)

Review theo yêu cầu chủ dự án: (1) luồng login + phân quyền, (2) `WorkflowDiagram` mới thêm ở
commit `f25484d`, trong đó mũi tên bị vẽ đè lên nhau rất xấu.

**Trạng thái (2026-09-03): 19/20 finding đã sửa xong; A10 mới sửa một nửa.** Ban đầu audit này chỉ
report; chủ dự án yêu cầu fix nên nhóm A (tầng vẽ cạnh) được sửa ngày 2026-09-02, rồi nhóm B
(login/phân quyền) + C (drift metadata) ngày 2026-09-03. Xem 2 mục "Đã sửa gì" ở cuối file để biết
fix nằm ở đâu và verify thế nào. Còn lại đúng một việc: nửa sau của A10 — thống nhất tooltip
lý-do-bị-chặn trên canvas (hiện vẫn là `<title>` native của SVG) sang `Tooltip` của `@metap/ui`.
Cố ý để riêng: bọc `TooltipTrigger asChild` quanh một `<g>` SVG là thay đổi có rủi ro về
positioning mà chính sách frontend verification không cho tự kiểm bằng browser, nên không đáng
nhét vào đợt này. Chưa commit gì (đúng quy ước `CLAUDE.md`: giữ nguyên diff để review trước).

**Đụng 2 repo**: `platform-ui` (nhóm A + phần lớn B) và `../metap` (B2, C1, và nửa backend của
B8 — thêm `email` vào `GET /auth/me`).

Quyết định kiến trúc khi sửa: **vá tầng vẽ cạnh tự viết, không kéo thêm graph-layout library**
(dagre...). Lý do: `layout.ts` đang chia sẻ với badge row của `WorkflowActionBar`, đổi thuật toán
xếp cột sẽ lan sang đó; mà mọi lỗi A1-A5 đều nằm ở **tầng vẽ cạnh**, không phải ở việc xếp cột —
thuật toán BFS-column vốn cho ra vị trí node hợp lý. Nếu sau này workflow phức tạp hơn nhiều thì
vẫn có thể đổi, nhưng đó là quyết định riêng chứ không phải điều kiện cần để sửa các lỗi ở đây.

Phương pháp: đọc trực tiếp source `src/workflow/*`, `src/auth/*`, `src/api/*`, `src/shell/*`,
`src/detail/RecordDetail.tsx`; đối chiếu ngược sang backend `../metap` (`metap-workflow`,
`metap-crud`, `metap-permission`, `metap-metadata`) để xác định đâu là giả định sai của FE chứ
không phải chỉ "nhìn xấu". Riêng phần hình học SVG được **verify bằng số**, không ước lượng bằng
mắt — tính lại toạ độ node/edge/label theo đúng công thức trong `WorkflowDiagram.tsx` cho workflow
`Zone` có thật ở `../metap-demo-waf/data-plane/docs/02-domain-model.md`, và lấy mẫu đường Bézier
để đo phần bị che. Không dùng browser automation (chính sách FE verification của `../metap`).

## Tóm tắt ưu tiên xử lý

Vị trí ghi theo **code trước khi sửa** (commit `f25484d`) — sau khi fix nhóm A thì số dòng đã khác.

| #   | Mức độ     | Vị trí                                         | Vấn đề                                                                                                                  | Trạng thái     |
| --- | ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------- |
| A1  | **HIGH**   | `workflow/WorkflowDiagram.tsx:287-293`         | Rect nền nhãn edge là màu đục, vẽ đè lên arrow + nhãn của edge vẽ trước — nguyên nhân trực tiếp của "mũi tên bị ghi đè" | ✅ Đã sửa      |
| A2  | **HIGH**   | `workflow/WorkflowDiagram.tsx:118-147, 270`    | Node vẽ sau edge; edge lùi có control point nằm trong hộp node → 93% đường bị node che                                  | ✅ Đã sửa      |
| A3  | **HIGH**   | `workflow/WorkflowDiagram.tsx:265-271`         | Self-loop (`from === to`) vẽ trọn vẹn bên trong hộp node → mất hoàn toàn                                                | ✅ Đã sửa      |
| A4  | **MEDIUM** | `workflow/WorkflowDiagram.tsx:265-271`         | Edge nhảy cột đi xuyên node trung gian — không có routing tránh vật cản                                                 | ✅ Đã sửa      |
| A5  | **MEDIUM** | `workflow/WorkflowDiagram.tsx:265-274`         | Hai transition cùng cặp `(from,to)` vẽ trùng khít 100% (cả path lẫn nhãn)                                               | ✅ Đã sửa      |
| A6  | **MEDIUM** | `workflow/WorkflowDiagram.tsx:128`             | `key={transition.action}` — action không unique toàn workflow, backend khớp theo `(action, from)`                       | ✅ Đã sửa      |
| A7  | **MEDIUM** | `workflow/layout.ts:5-32`                      | State không reachable từ `initialState` bị âm thầm bỏ khỏi diagram (cả node lẫn edge)                                   | ✅ Đã sửa      |
| B1  | **MEDIUM** | `detail/RecordDetail.tsx:109-123`              | Nút Edit/Delete bỏ qua `capabilities.canUpdate` dù dữ liệu đã có sẵn trong cùng response                                | ✅ Đã sửa      |
| B2  | **MEDIUM** | `../metap` `crud_service/helpers.rs:483`       | `RecordCapabilities` không có `canDelete` — FE không có cách nào gate nút Delete                                        | ✅ Đã sửa (BE) |
| B3  | **MEDIUM** | `auth/OidcCallbackPage.tsx:17-26`              | JWT nằm lại trong browser history sau OIDC callback (navigate push, không replace, không xoá hash)                      | ✅ Đã sửa      |
| C1  | **MEDIUM** | `../metap` `metap-metadata/src/openapi.rs:137` | Schema `WorkflowTransition` thiếu `validator`/`setFields` → `generated-types.ts` thiếu theo                             | ✅ Đã sửa (BE) |
| A8  | LOW        | `workflow/WorkflowDiagram.tsx:288-290`         | Bề rộng nhãn ước lượng bằng `label.length * 6`, không đo text thật                                                      | ✅ Đã sửa      |
| A9  | LOW        | `workflow/WorkflowDiagram.tsx:92`              | SVG không có `viewBox` → không fit được dialog, luôn scroll ngang từ 4 cột trở lên                                      | ✅ Đã sửa      |
| A10 | LOW        | `workflow/WorkflowDiagram.tsx:92, 278`         | `role="img"` ở svg cha nuốt hết `<title>` con; tooltip native lệch chuẩn với `Tooltip` của `@metap/ui` ngay cạnh        | 🟡 Sửa một nửa |
| A11 | LOW        | `index.ts`                                     | `WorkflowDiagram`/`TransitionButtons`/`layout` không export — consumer không nhúng riêng được                           | ✅ Đã sửa      |
| B4  | LOW        | `auth/OidcCallbackPage.tsx:17-26`              | Không xử lý callback thiếu token / trả `#error=` — treo vĩnh viễn ở "Signing you in…"                                   | ✅ Đã sửa      |
| B5  | LOW        | `auth/OidcCallbackPage.tsx:30`                 | Hardcode tiếng Anh "Signing you in…" — file duy nhất còn sót, trái với tuyên bố i18n ở `README.md`                      | ✅ Đã sửa      |
| B6  | LOW        | `admin/*.tsx`, `auth/Can.tsx`                  | `Can` export nhưng không dùng ở đâu; 4 trang admin không tự gate role                                                   | ✅ Đã sửa      |
| B7  | LOW        | `shell/AppShellLayout.tsx:19-22`               | `roles: []` (mảng rỗng) bị hiểu là "không ai được xem" thay vì "không giới hạn"                                         | ✅ Đã sửa      |
| B8  | LOW        | `auth/useTenantUsers.ts:24-28`                 | Kéo toàn bộ user list của tenant chỉ để lấy email của chính mình, chạy ở mọi trang                                      | ✅ Đã sửa      |

---

# A. `WorkflowDiagram` — vẽ mũi tên

## Dữ liệu dùng để verify

Workflow `Zone` (`../metap-demo-waf/data-plane/docs/02-domain-model.md`, mục `Zone`):
`pending → active → paused → active`, và `active → suspended` (terminal).

Chạy lại đúng công thức trong `WorkflowDiagram.tsx` (`COLUMN_WIDTH=220`, `ROW_HEIGHT=76`,
`NODE_WIDTH=168`, `NODE_HEIGHT=40`, `PADDING_X=56`, `PADDING_Y=28`):

```
levels    : pending=0, active=1, paused=2, suspended=2
positions : pending(56,28) active(276,28) paused(496,28) suspended(496,104)

activate  pending->active     fwd=true   M224,48  C250,48  250,48   276,48
          label@(250,42)  rect x222..278  y34..48
pause     active->paused      fwd=true   M444,48  C470,48  470,48   496,48
          label@(470,42)  rect x451..489  y34..48
resume    paused->active      fwd=false  M580,68  C640,68  640,28   360,28
          label@(470,48)  rect x448..492  y40..54
suspend   active->suspended   fwd=true   M444,48  C470,48  470,124  496,124
          label@(470,80)  rect x445..495  y72..86
```

Đây là workflow 4 state đơn giản nhất mà sản phẩm thật đang có — không phải case dựng lên cho
đủ xấu.

## A1. [HIGH] Rect nền nhãn đục vẽ đè lên edge khác — `WorkflowDiagram.tsx:287-293`

```tsx
<rect
  x={labelX - label.length * 3 - 4}
  y={labelY - 8}
  width={label.length * 6 + 8}
  height={14}
  className="fill-background"
/>
```

Mỗi `Edge` tự vẽ một rect **đục** (`fill-background`) làm nền cho nhãn. Toàn bộ edge được map
trong **một lượt** theo đúng thứ tự mảng `workflow.transitions` (`:118-136`), nên rect của edge
thứ N phủ lên path + nhãn của mọi edge `1..N-1`. SVG không có `z-index` — thứ tự trong document
chính là thứ tự vẽ.

Với workflow `Zone` ở trên, hai edge liền nhau đụng nhau gần như hoàn toàn:

- nhãn `pause` : rect `x451..489`, `y34..48`
- nhãn `resume` : rect `x448..492`, `y40..54` — vẽ **sau**

Hai rect chồng nhau 8px chiều dọc và gần trọn chiều ngang. Và đường arrow của `pause` chạy ngang
**y=48 từ x444→x496** — nằm gọn trong rect của `resume`. Kết quả: rect trắng của `resume` **xoá
mất đoạn giữa mũi tên `pause`** và che luôn chữ "pause". Đây chính xác là hiện tượng chủ dự án
báo.

Không có bất kỳ cơ chế chống chồng nhãn nào: không offset theo index, không đo bounding box, không
gom nhãn ra một layer vẽ sau cùng.

**Hướng xử lý** (chọn 1, không phải làm hết): (a) bỏ rect, dùng `paint-order="stroke"` +
`stroke="var(--background)"` `stroke-width=3` trên chính `<text>` — halo chữ thay vì hộp đục, đè
ít hơn hẳn; (b) tách nhãn ra một `<g>` render sau toàn bộ path (nhãn vẫn đè path nhưng ít nhất
mọi arrow đều còn nguyên, không phụ thuộc thứ tự mảng); (c) offset nhãn theo chỉ số edge trong
cùng cặp cột.

## A2. [HIGH] Node vẽ sau edge, edge lùi chui vào trong hộp node — `:118-147`, `:270`

Thứ tự render: edges (`:118-136`) → nodes (`:138-147`). Node là rect **đục**
(`fill-background`/`fill-primary`), nên mọi đoạn edge đi qua vùng node đều bị che.

Với edge lùi (`to.col <= from.col`), control point là:

```ts
const midX = forward ? (x1 + x2) / 2 : x1 + 60; // :270
```

`x1 = from.x + NODE_WIDTH / 2` (tâm ngang node), nên `midX = from.x + 84 + 60 = from.x + 144`.
Node rộng `168` tính từ `from.x` → **`midX` nằm bên trong hộp node nguồn** (144 < 168). Đường cong
bắt buộc phải đi xuyên chính node phát ra nó.

Lấy mẫu 41 điểm trên đường Bézier `resume` (`M580,68 C640,68 640,28 360,28`) và kiểm tra từng
điểm có nằm trong hộp node nào không:

```
t=0.00 (580.0, 68.0)  inside=['paused']
t=0.25 (610.3, 61.8)  inside=['paused']
t=0.50 (597.5, 48.0)  inside=['paused']
t=0.75 (520.9, 34.2)  inside=['paused']
t=0.88 (452.3, 29.7)  inside=[]
t=1.00 (360.0, 28.0)  inside=['active']

38/41 điểm (93%) nằm trong hộp node → bị che
```

Nghĩa là mũi tên `resume` gần như **không tồn tại về mặt thị giác** — chỉ còn ~7% ở khoảng trống
giữa hai cột. Người dùng thấy một mẩu đường cụt, không thấy nó nối `paused → active`.

**Hướng xử lý**: đưa `midX` ra **ngoài** hộp node (`from.x + NODE_WIDTH + margin`), và/hoặc định
tuyến edge lùi vòng dưới hàng node (đi xuống dưới `ROW_HEIGHT` rồi chạy ngang) thay vì cắt ngang.
Việc render node trước edge **không** phải cách sửa (làm vậy edge sẽ đè lên chữ trong node).

## A3. [HIGH] Self-loop mất hoàn toàn — `:265-271`

`from === to` rơi vào nhánh `forward = false`:

- `x1 = x2 = pos.x + 84` (cùng tâm ngang)
- `y1 = pos.y + 40` (đáy node), `y2 = pos.y` (đỉnh node)
- `midX = pos.x + 144`

Toàn bộ đường cong nằm trong dải `x ∈ [pos.x+84, pos.x+144]` và `y ∈ [pos.y, pos.y+40]` — tức
**nằm trọn trong hộp node**, bị node vẽ đè 100%. Nhãn cũng rơi vào `labelX = pos.x+84`,
`labelY = pos.y+20` = tâm node.

Self-loop là hình dạng workflow hoàn toàn hợp lệ (vd một action "cập nhật/ghi chú" giữ nguyên
state). Hiện tại nó biến mất không dấu vết, không có cảnh báo.

**Hướng xử lý**: case riêng cho `from === to` — vẽ cung tròn phía trên node
(`M x+w*0.3,y  C x+w*0.3,y-30  x+w*0.7,y-30  x+w*0.7,y`), và cộng thêm khoảng đệm trên vào
`height`/`PADDING_Y` để cung không bị cắt khỏi canvas.

## A4. [MEDIUM] Edge nhảy cột xuyên node trung gian — `:265-271`

Với `to.col > from.col + 1`, path gần như là đường thẳng ngang từ mép phải node nguồn tới mép trái
node đích. Không có bước tránh vật cản nào, nên nó cắt qua mọi node nằm ở cột trung gian **cùng
hàng** — và bị che (A2).

Rất dễ gặp: một action "cancel"/"suspend" từ state đầu tới thẳng state terminal ở cột cuối.

## A5. [MEDIUM] Hai transition cùng cặp `(from, to)` vẽ trùng khít — `:265-274`

`x1/y1/x2/y2/midX/labelX/labelY` được tính **chỉ từ vị trí hai node**, không có tham số phân biệt
edge. Hai action khác nhau nhưng cùng `from` và cùng `to` (vd `approve` và `fastTrack` đều
`review → done`) sinh ra **path giống hệt nhau từng pixel** và **nhãn ở đúng một toạ độ**. Người
dùng chỉ thấy một mũi tên và một nhãn nhoè (nhãn sau đè nhãn trước).

**Hướng xử lý**: nhóm transition theo `(from,to)`, truyền `index`/`total` vào `Edge` để lệch
curvature (offset control point theo `(index - (total-1)/2) * step`).

## A6. [MEDIUM] `key={transition.action}` — duplicate React key — `:128`

```tsx
{workflow.transitions.map((transition) => (
  <Edge key={transition.action} ... />
))}
```

`action` **không** unique trong phạm vi workflow. Backend khớp transition theo cặp
`(action, from_state)`:

```rust
// ../metap/crates/metap-workflow/src/lib.rs:38
.find(|t| t.action == action && t.from == from_state)
```

và có hẳn test `find_transition_matches_on_action_and_from_state` (`:329`) chốt hành vi này.
`crates/metap-metadata/src/entity.rs`'s `WorkflowTransition` cũng không ràng buộc unique trên
`action`. Trường hợp thực tế rất phổ biến: cùng một action `suspend`/`cancel` phát từ nhiều state
(đúng mô tả `Zone`: `suspended` là terminal do platform admin khoá, tức đi được từ nhiều state).

Khi đó React nhận key trùng → warning, và reconciliation có thể ghép nhầm/bỏ sót phần tử khi danh
sách đổi.

**Hướng xử lý**: `key={`${transition.from}->${transition.to}:${transition.action}`}`.

Ghi chú: `transitionInfo` (Map keyed by `action`, `WorkflowActionBar.tsx:59-62`) **không** dính lỗi
này — backend chỉ đưa vào `capabilities.transitions` các transition có `from == current_state`
(`compute_capabilities`, `crud_service/helpers.rs:507-510`), nên trong phạm vi đó `action` là
unique. `WorkflowDiagram` cũng đã chặn đúng bằng `isFromCurrentState` trước khi tra `blockedActions`
(`:124-125`). Chỉ riêng `key` là sai.

## A7. [MEDIUM] State không reachable bị âm thầm biến mất — `layout.ts:5-32`

`computeLevels` là BFS **chỉ xuất phát từ `workflow.initialState`**. State nào không tới được từ
đó sẽ không có level → không có entry trong `positions` → trong `WorkflowDiagram`:

- node: không được render (map chạy trên `positions.entries()`, `:138`)
- edge: `if (!from || !to) return null` (`:121-123`) — bỏ im lặng

Diagram tự nhận là "canvas view of a workflow" nhưng có thể đang giấu một phần workflow mà không
báo gì. Các nguồn gây ra: một component rời rạc trong đồ thị, hoặc một state chỉ được liệt kê ở
`terminalStates` mà không có transition nào reachable trỏ tới (`EntityWorkflow` không có mảng
`states` tường minh — mọi state đều suy ra từ `initialState`/`terminalStates`/`transitions`).

Lỗi này ảnh hưởng **cả** `WorkflowActionBar`'s badge row vì dùng chung `groupByLevel`
(`WorkflowActionBar.tsx:53`) — đúng như doc comment của `layout.ts` nói ("shared ... so the two
views can never disagree"), nhưng ở đây nghĩa là cả hai cùng sai giống nhau.

Phụ: `groupByLevel` gọi `Math.max(...levels.values())` — với map rỗng trả `-Infinity`
(`Array.from({length: -Infinity})` may mắn ra `[]` chứ không throw, nhưng là dựa vào may).

**Hướng xử lý**: sau BFS, gom mọi state xuất hiện trong `transitions`/`terminalStates` mà chưa có
level, xếp vào một cột "unreachable" cuối cùng (hoặc ít nhất log/hiện cảnh báo), thay vì bỏ im.

## A8. [LOW] Ước lượng bề rộng nhãn — `:288-290`

`label.length * 6` (và `* 3` cho nửa) giả định mỗi ký tự rộng 6px ở `fontSize=10`. Không đo text
thật (`getComputedTextLength`). Nhãn đi qua `transitionLabel()` nên là chuỗi i18n — tiếng Việt có
dấu, chữ hoa, hay nhãn dài đều lệch. Rect hụt → nền không phủ hết chữ; rect thừa → che thêm thứ
không cần che (cộng dồn với A1).

Phần **căn giữa** thì đúng (`x = labelX - len*3 - 4`, `width = len*6 + 8` → đối xứng) — chỉ sai
kích thước.

## A9. [LOW] SVG không có `viewBox` — `:92`

`<svg width={width} height={height}>` cố định, không `viewBox`/`preserveAspectRatio`. Dialog là
`max-w-3xl` (768px); workflow 4 cột đã là `56 + 4*220 = 936px` → luôn scroll ngang, không có cách
nào thu nhỏ để nhìn toàn cảnh. Thêm `viewBox="0 0 {width} {height}"` + `width="100%"` cho phép fit
mà không đổi gì khác.

## A10. [LOW] a11y & tooltip lệch chuẩn — `:92`, `:278`

- `<svg role="img" aria-label=...>` khiến screen reader coi cả canvas là **một** ảnh và bỏ qua
  toàn bộ `<title>` bên trong — kể cả `<title>{reason}</title>` giải thích vì sao transition bị
  chặn (`:278`). Thông tin đó chỉ còn đến được người dùng chuột.
- Tooltip lý do dùng `<title>` native của SVG, trong khi `TransitionButtons` ngay bên dưới trong
  cùng dialog dùng `Tooltip`/`TooltipContent` của `@metap/ui` (`TransitionButtons.tsx:51-56`). Hai
  cơ chế tooltip khác nhau, khác hẳn về style và độ trễ, trong cùng một màn hình.
- Doc comment của `WorkflowDiagram` nói "Renders inside a `TooltipProvider`" — đúng, nhưng là do
  `TransitionButtons` cần, bản thân canvas không dùng `Tooltip` nào.

## A11. [LOW] Không export ở `index.ts`

`index.ts` chỉ có `export * from "./workflow/WorkflowActionBar"`. `WorkflowDiagram`,
`TransitionButtons`, `layout.ts` đều không export. Consumer muốn nhúng canvas ở chỗ khác (vd trang
metadata/admin xem workflow của entity **không gắn với record cụ thể** nào) thì không lấy được.
Cân nhắc export ít nhất `WorkflowDiagram` + `computeLevels`/`groupByLevel`.

---

# B. Login & phân quyền

## B1. [MEDIUM] `RecordDetail` bỏ qua `capabilities.canUpdate` — `RecordDetail.tsx:109-123`

Nút Edit và Delete render vô điều kiện:

```tsx
<navAdapter.Link to={navAdapter.toEditRecord(entityName, id)} ...>{t("common.edit")}</navAdapter.Link>
<Button variant="ghost" ... onClick={() => void handleDelete()}>{t("common.delete")}</Button>
```

Trong khi `record.capabilities` **đã có sẵn ngay trong response đó** và đã được dùng ở nơi khác:
truyền xuống `WorkflowActionBar` (`:178`), và `GeneratedForm` đã tôn trọng `writableFields`
(`GeneratedForm.tsx:53-54, 143`).

Hệ quả: user không có quyền update bấm Edit → sang form thấy **mọi field disabled**, ngõ cụt không
giải thích; bấm Delete → qua `window.confirm` rồi mới nhận 403 hiển thị dạng alert.

Không phải lỗ hổng bảo mật (server vẫn chặn — `CrudService` check permission độc lập), nhưng lệch
chuẩn với chính package và là trải nghiệm xấu ở đúng phần "phân quyền".

**Hướng xử lý**: ẩn/disable Edit khi `!capabilities.canUpdate` (kèm tooltip lý do, giống cách
`TransitionButtons` đã làm cho transition bị chặn).

## B2. [MEDIUM] Không có `canDelete` trong `RecordCapabilities` — backend

`EntityAction` ở backend có đủ `Read/Create/Update/Delete/Transition`
(`../metap/crates/metap-permission/src/context.rs:93-101`), nhưng `compute_capabilities`
(`../metap/crates/metap-crud/src/crud_service/helpers.rs:483-533`) chỉ tính:

```rust
let can_update = ... EntityAction::Update ...;
let transition_decision = ... EntityAction::Transition ...;
```

Không có `EntityAction::Delete`. Nên kể cả khi sửa B1, FE **vẫn không có cách nào** gate nút
Delete cho đúng — chỉ có thể mượn tạm `canUpdate`, mà đó là quyền khác (backend đã cố ý tách
`Update` khỏi `Transition` vì đúng lý do này, xem comment ngay tại `helpers.rs:494-497`).

**Hướng xử lý**: thêm `can_delete` vào `RecordCapabilities` ở backend, rồi FE mới gate được. Là
việc ở `../metap`, không phải ở đây.

## B3. [MEDIUM] JWT nằm lại trong browser history sau OIDC callback — `OidcCallbackPage.tsx:17-26`

```tsx
const hash = window.location.hash;
const token = hash.startsWith("#token=") ? decodeURIComponent(hash.slice("#token=".length)) : null;
if (token) {
  setToken(token);
  navAdapter.navigate(navAdapter.toHome());
}
```

Doc comment của file giải thích rất đúng vì sao backend dùng URL fragment thay vì query param
(fragment không vào server access log / `Referer`). Nhưng phía client thì:

- `navigate()` là **push**, không phải replace → entry `/auth/callback#token=<JWT>` **vẫn nằm
  trong session history**. Bấm Back là quay lại URL chứa nguyên JWT.
- Hash không được xoá bằng `history.replaceState` sau khi đọc.

Đây là phần lợi ích của thiết kế fragment bị trả lại một nửa.

Chặn ở đây: `NavigationAdapter.navigate` khai báo là `(path: string) => void`
(`NavigationContext.ts:12`) — **không có option `replace`**, nên không sửa được tại chỗ gọi, phải
mở rộng interface adapter trước (`navigate: (path: string, options?: { replace?: boolean }) => void`
— `react-router`'s `useNavigate` đã hỗ trợ sẵn, `ReactRouterNavigationProvider` chỉ việc truyền
qua).

**Hướng xử lý**: `window.history.replaceState(null, "", window.location.pathname)` ngay sau khi
đọc token, **và** mở rộng adapter để `navigate(toHome(), { replace: true })`.

## B4. [LOW] Callback không xử lý trường hợp thiếu token — `OidcCallbackPage.tsx:17-26`

Nếu hash không đúng dạng `#token=` (IdP trả lỗi — thường là `#error=access_denied`, hoặc user mở
thẳng URL callback), `token` là `null`, `if (token)` không chạy, và **không có nhánh else**. Trang
đứng vĩnh viễn ở "Signing you in…" — không báo lỗi, không redirect về `/login`.

## B5. [LOW] Hardcode tiếng Anh — `OidcCallbackPage.tsx:30`

```tsx
<p className="text-sm text-foreground">Signing you in…</p>
```

`README.md` tuyên bố "**i18n đã đủ (2026-08-31)** — ... Toàn bộ `src/` giờ đi qua `react-i18next`
như phần còn lại của package." Grep toàn `src/` xác nhận **đây là chỗ duy nhất còn sót**. Cần thêm
key (vd `login.signingIn`) vào `i18n/resources.ts` và sửa README nếu muốn giữ tuyên bố đó đúng.

## B6. [LOW] `Can` không được dùng; admin pages không tự gate role

`Can` (`auth/Can.tsx:21`) được export ở `index.ts` nhưng **không có call site nào trong `src/`** —
chỉ `useHasRole` được dùng, và chỉ ở `AppShellLayout`'s `NavLink`. Bốn trang admin
(`PoliciesAdminPage`, `UsersAdminPage`, `CronJobsAdminPage`, `LowCodeEntitiesAdminPage`) không có
role gate nội bộ nào, phụ thuộc hoàn toàn vào việc consumer app nhớ bọc route.

Consumer quên bọc → trang vẫn render đầy đủ form, gọi `/admin/*`, nhận 403, hiện alert lỗi. Server
vẫn chặn nên không phải lỗ hổng, nhưng `Can` tồn tại đúng để tránh chuyện này mà lại không được
dùng ở nơi cần nhất. Cân nhắc cho mỗi trang admin tự bọc `<Can roles={["admin"]} fallback={...}>`.

## B7. [LOW] `roles: []` bị hiểu ngược — `AppShellLayout.tsx:19-22`

```tsx
const allowedByRole = useHasRole(item.roles ?? []);
if (item.roles && !allowedByRole) return null;
```

`[]` là truthy trong JS, và `useHasRole([])` trả `false` (`[].some(...)` = false) → nav item khai
báo `roles: []` bị ẩn với **mọi** user. Trong khi ngữ nghĩa tự nhiên của "mảng role rỗng" thường
được hiểu là "không giới hạn" (giống `roles` bị omit). Nên hoặc chuẩn hoá về
`item.roles?.length ? ... : true`, hoặc ghi rõ trong doc comment của `ShellNavItem` rằng `[]` =
không ai xem được.

## B8. [LOW] Kéo cả user list của tenant chỉ để lấy 1 email — `useTenantUsers.ts:24-28`

`useCurrentUserEmail()` gọi `useTenantUsers()` (= `GET /users`, **toàn bộ** user của tenant) rồi
`users.find(u => u.id === me?.userId)`. Nó chạy trong `AppShellLayout` (`:53`) tức là ở **mọi
trang** đã đăng nhập.

Doc comment nói "fetches the whole tenant user list once (not per-render), so this costs nothing
extra beyond what `useCurrentUser` already fetches" — điều này chỉ đúng khi tenant nhỏ. Với tenant
vài nghìn user thì đây là payload thừa đáng kể chỉ để hiển thị email của chính mình ở header. Thêm
nữa `useApiQuery` không set `staleTime` cho query này → dùng default của consumer's `QueryClient`
(thường là `0` + `refetchOnWindowFocus: true`), nghĩa là **fetch lại cả list mỗi lần focus cửa sổ**.

**Hướng xử lý**: thêm `email` vào response của `GET /auth/me` ở backend (đúng chỗ nhất), hoặc ít
nhất set `staleTime` dài cho `["tenant-users"]`.

---

# C. Drift metadata (backend, lộ ra ở FE)

## C1. [MEDIUM] Schema `WorkflowTransition` thiếu field — `../metap` `openapi.rs:137-153`

`entity.rs`'s `WorkflowTransition` có 7 field: `action`, `from`, `to`, `label`, `guard`,
`validator`, `set_fields`. Nhưng `workflow_transition_json_schema()` chỉ khai báo 5:

```rust
"properties": { "action", "from", "to", "label", "guard" },
"required": ["action", "from", "to", "label"],
```

Thiếu `validator` và `set_fields`. Vì `platform-ui`'s `metadata/generated-types.ts` được generate
từ `GET /metadata/openapi.json`, FE hiện chỉ thấy:

```ts
transitions: { action: string; from: string; guard?: unknown; label: string; to: string }[];
```

Đây đúng loại drift mà `CLAUDE.md` cảnh báo ("`openapi.rs`'s hand-written `EntitySummary` JSON
Schema ... must stay in sync with `entity.rs`'s structs") — không có bước reflection tự động nào
bắt được.

Hệ quả cụ thể cho `WorkflowDiagram`: transition có `validator` vẫn được vẽ/hiện là "available".
Điều này **tự nó không sai** — `compute_capabilities` cố ý chỉ chạy `run_guard`, vì `validator`
cần payload chưa tồn tại tại thời điểm đó (xem doc comment `entity.rs:213-222`). Nhưng FE thậm chí
không **biết** transition đó có `validator` để gợi ý "action này sẽ cần nhập thêm dữ liệu", nên
user bấm xong mới bị từ chối. Sửa schema là điều kiện cần nếu sau này muốn xử lý tử tế.

---

## Đã sửa gì (2026-09-02, sau khi chủ dự án duyệt)

Chỉ 2 file: `src/workflow/WorkflowDiagram.tsx` và `src/workflow/layout.ts`. Không đụng
`design-system` (không thêm primitive nào), không thêm dependency, không đổi `index.ts`, không đổi
i18n (fix này không thêm chuỗi UI nào).

**`layout.ts`** — thêm `allStates()` gom mọi state workflow có nhắc tới (`initialState`, `from`/`to`
của mọi transition, `terminalStates`); state nào BFS không tới được thì xếp vào một cột phụ cuối
thay vì bị bỏ (A7). Guard thêm 2 chỗ: `initialState` rỗng không còn seed một state ma ở level 0, và
`groupByLevel` bail sớm khi map rỗng thay vì dựa vào việc `Array.from({length: -Infinity})` tình cờ
trả `[]`.

**`WorkflowDiagram.tsx`** — thay đổi cốt lõi là **tách render thành 3 pass**: mọi path → mọi nhãn →
mọi node. SVG không có `z-index`, thứ tự vẽ chính là thứ tự chồng, nên gộp path + nền nhãn vào 1
lượt trước node là nguyên nhân gốc của A1/A2. Kèm theo:

- Bỏ hẳn `<rect>` nền đục, đổi sang halo chữ (`paintOrder="stroke"` + `stroke-background`) — vừa
  đóng A1 vừa đóng A8 luôn (không còn ước lượng `label.length * 6` nào để mà sai).
- `edgeGeometry()` thay công thức đơn cũ bằng **4 nhánh routing**, chọn theo vị trí tương đối 2
  node, sao cho không đoạn nào chạy trong hộp node: self-loop → cung vòng lên trên (A3); cùng cột →
  bow sang phải, cap trong `COLUMN_GAP - 6` để không chạm cột kế; cột liền kề → thẳng qua gutter
  giữa 2 cột (nhánh này vốn đã an toàn, chỉ thêm offset); còn lại (lùi cột, hoặc nhảy cột) → thả
  xuống gutter giữa 2 hàng rồi vòng lên đáy node đích (A2, A4).
- Fan cạnh song song bằng 2 thước đo khác nhau: `spread` (đối xứng quanh 0) cho nhánh thẳng, và
  `ordinal` (0,1,2...) cho 3 nhánh một chiều — vì một cái bow luôn phình sang phải sẽ map `-0.5` và
  `+0.5` vào **đúng cùng một đường** nếu lấy trị tuyệt đối (A5).
- Gom nhóm cạnh song song theo **cặp không thứ tự** (`a|b` chứ không `a→b`): 2 cạnh ngược chiều
  trong cùng một cột cùng ra một bow, nên gom theo cặp có thứ tự sẽ để mỗi chiều tưởng nó là duy
  nhất rồi vẽ đè lên nhau (đối xứng gương).
- `key` đổi sang `${from}|${to}|${action}` (A6), `viewBox` + `maxWidth: 100%` để canvas co được vào
  dialog (A9), `PADDING_Y` 28 → 48 lấy chỗ cho cung self-loop và nhãn của nó.
- A10 mới sửa một nửa: `role="img"` ở svg cha đổi thành `role="group"` và mỗi cạnh thành
  `role="img"` + `aria-label`, nên `<title>` lý do-bị-chặn giờ tới được screen reader. Phần còn lại
  (tooltip native `<title>` vs `Tooltip` của `@metap/ui` ở `TransitionButtons` ngay cạnh) **chưa**
  thống nhất — đổi sang `Tooltip` cho phần tử SVG cần bọc `TooltipTrigger asChild` quanh `<g>`,
  đáng làm riêng chứ không nhét vào đợt này.

### Verify

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` đều sạch (lint: 0 warning trong
  `src/workflow/`; các warning còn lại đều ở file khác và có từ trước). Lưu ý cho session sau: phải
  `pnpm build` bên `../design-system` trước, nếu không typecheck sẽ đỏ hàng loạt
  `Cannot find module '@metap/ui'` — consumer resolve qua `dist/`, không phải `src/`.
- Hình học verify lại **bằng số** đúng cách audit đã dùng để tìm ra lỗi: port `edgeGeometry` sang
  script, lấy 201 mẫu trên mỗi đường Bézier, đếm số điểm rơi vào trong hộp node. Chạy trên 3
  workflow — `Zone` và `Incident` (đều từ `metap-demo-waf`) cộng một case stress tự dựng có đủ
  self-loop + 2 cạnh song song + cạnh nhảy cột + cạnh ngược chiều cùng cột:

  | Workflow    | Trước          | Sau    |
  | ----------- | -------------- | ------ |
  | `Zone`      | 93% (`resume`) | **0%** |
  | `Incident`  | —              | **0%** |
  | stress case | —              | **0%** |

  Không điểm nào nằm ngoài canvas, và mọi nhãn cách nhau ≥13px (trước đó có cặp chồng 8px). Chính
  bước verify này bắt được 2 lỗi **trong bản fix**: `Math.abs(spread)` làm cặp song song `±0.5`
  triệt tiêu thành cùng một đường, và cặp ngược chiều cùng cột vẫn trùng khít do gom nhóm theo cặp
  có thứ tự. Cả hai đã sửa trước khi báo xong.

- **Chưa xem trên browser thật** — đúng "Frontend verification policy (2026-08-11)". Số liệu trên
  chứng minh không đoạn cạnh nào bị che và không nhãn nào chồng nhau, nhưng những thứ chỉ mắt mới
  đánh giá được (halo chữ có dày quá không, bow/dip có thoáng không, self-loop có cân không) thì
  cần chủ dự án nhìn.

## Đã sửa gì — nhóm B + C (2026-09-03)

Đợt này đụng **2 repo**. Thứ tự bắt buộc: B2 (backend) phải xong trước B1, vì trước đó FE không có
dữ liệu nào để gate nút Delete.

### `../metap` (backend)

- **B2 — `canDelete`.** `RecordCapabilities` thêm `can_delete`, `compute_capabilities` tính nó từ
  `EntityAction::Delete` (song song với `can_update`/`transition_decision` đã có). **Kèm một sửa
  không hiển nhiên**: `get.rs`/`get_many.rs` phải thêm `EntityAction::Delete` vào danh sách truyền
  cho `enrich_record_for_actions` — hàm này chỉ resolve các relation field mà những action được
  liệt kê cần tới, nên nếu thiếu, một delete policy điều kiện trên relation field sẽ bị đánh giá
  trên dữ liệu chưa enrich và trả `canDelete` sai. Đây là loại lỗi im lặng, không có gì báo.
- **B2 (tiếp) — tương thích ngược cho gRPC.** `metap_grpc::client::deserialize_capabilities` parse
  thẳng response của service khác vào struct này, nên một field bắt buộc mới sẽ làm **fail cứng cả
  `get`** khi gateway trỏ vào upstream build từ code cũ. Thêm `#[serde(default)]` để hạ mức thiệt
  hại xuống "nút Delete bị ẩn với upstream cũ" — thứ server vẫn enforce độc lập.
- **C1 — schema drift.** `workflow_transition_json_schema()` thêm `validator` + `setFields`, khớp
  lại với `entity.rs`'s `WorkflowTransition`. **Chưa regenerate `generated-types.ts`** — bước đó
  cần một backend đang chạy (`pnpm generate:types` gọi `localhost:3000`), mà repo `metap` không có
  app chạy được và 2 repo demo (`metap-demo-crm`/`metap-demo-jira`) không nằm trong scope session
  này. Việc còn lại cho chủ dự án: chạy 1 demo app rồi `cd ../platform-ui && pnpm generate:types`.
- **B8 (nửa backend) — `email` trên `GET /auth/me`.** Thêm `metap_peripherals::find_user_by_id`
  (scope theo tenant nên id của tenant khác không bao giờ resolve) và gọi nó trong handler `me`.
  Cố ý **additive + best-effort**: mọi lỗi (router unavailable, không có row, `sub` không phải user
  thật) đều ra `null` chứ không làm hỏng payload identity/roles — đó mới là thứ mọi caller gate lên.

### `platform-ui` (frontend)

- **B1 — gate Edit/Delete.** Cả 2 nút giờ đọc `record.capabilities` vốn đã nằm sẵn trong cùng
  response. Disable + tooltip lý do (giống `TransitionButtons`), không phải ẩn đi. `canDelete`
  dùng so sánh `=== false` chứ không phải falsy: `undefined` (backend cũ) nghĩa là "không biết,
  đừng gate" — ẩn nhầm nút của người có quyền là hỏng nặng hơn.
- **B3/B4/B5 — OIDC callback.** `NavigationAdapter.navigate` thêm option `replace` (optional, nên
  adapter tự viết sẵn có vẫn type-check nguyên); callback giờ `history.replaceState` xoá token khỏi
  URL **trước** khi `setToken`, rồi `navigate(toHome(), { replace: true })` — không còn entry
  `#token=<JWT>` trong history để bấm Back về. Callback không có token (IdP trả `#error=`, hoặc mở
  thẳng URL) hiện thông báo lỗi + link về `/login` thay vì treo mãi. Chuỗi hardcode tiếng Anh cuối
  cùng trong `src/` đã chuyển sang i18n (`common.signingIn`, en + vi).
- **B6 — admin pages tự gate.** Thêm `AdminOnly` (`auth/AdminOnly.tsx`), bọc cả 4 trang admin.
  Điểm quan trọng: nó bọc **bên ngoài** thân component cũ (đổi tên thành `*Content`), nên hook
  trong đó không chạy — người không phải admin không bắn request `/admin/*` nào cả, thay vì xem
  trang dựng lên rồi phủ đầy alert 403. Hardcode role `"admin"` **an toàn tuyệt đối** ở đây vì
  backend `RequestContext::is_admin` cũng so đúng literal đó, nên gate này không thể ẩn trang khỏi
  người mà server sẽ cho vào. Khác `Can` một điểm: `Can` coi "đang load" là "không được phép" —
  đúng cho 1 cái nút, sai cho cả trang (sẽ nháy thông báo từ chối vào mặt admin trước khi role kịp
  về), nên `AdminOnly` chờ.
- **B7 — `roles: []`.** `item.roles && !allowed` → `item.roles?.length && !allowed`. Mảng rỗng giờ
  nghĩa là "không giới hạn", không còn là "không ai xem được" do `[]` truthy trong JS.
- **B8 (nửa FE).** `useCurrentUserEmail` đọc thẳng `me.email`. Fallback tra tenant list vẫn giữ cho
  backend cũ nhưng **skip hẳn request** (`enabled: false`) khi `/auth/me` đã trả email.
  `useTenantUsers` thêm param `enabled` (default `true`, mọi call site cũ không đổi) và
  `staleTime: 5 phút` — trước đó không set nên ăn default `0` của React Query, tức refetch cả danh
  sách user mỗi lần focus cửa sổ.
- **A11** (làm nốt cho trọn): export `WorkflowDiagram`/`TransitionButtons`/`layout` từ `index.ts`.

### Verify

- `../metap`: `cargo build --workspace`, `cargo clippy --workspace --all-targets`,
  `cargo test --workspace` — sạch cả 3. E2E (`-- --ignored`) **chưa chạy**: cần Postgres/RabbitMQ
  đang chạy, không dựng trong session này.
- `platform-ui`: `pnpm typecheck` / `pnpm lint` / `pnpm format:check` sạch. Lint về đúng baseline 6
  warning có sẵn từ trước, 0 warning ở file đụng tới. Trong lúc làm lint bắt được 1 lỗi thật của
  bản fix (`setState` trong `useEffect` ở `OidcCallbackPage`) — sửa bằng cách derive token lúc
  render qua lazy `useState` initializer, effect chỉ còn side effect thuần.
- **Phát hiện ngoài lề, đã sửa**: `cargo clippy --workspace --all-targets` đang **vỡ sẵn** trên
  branch từ commit `bd2c05e` (HEAD) — commit đó thêm field `computed` vào `EntityField` nhưng bỏ
  sót 2 bench fixture (`metap-query/benches/plan_list_bench.rs`,
  `metap-reconciler/benches/diff_bench.rs`). `cargo build --workspace` không bắt vì bench không
  build mặc định. Thêm `computed: None` vào cả 2. **Không liên quan tới audit này** — sửa vì nó
  chặn việc lấy tín hiệu clippy sạch cho chính các thay đổi ở trên.
- Không chạy browser (đúng "Frontend verification policy"). Những thứ cần mắt: tooltip trên nút
  Edit/Delete bị disable, trang admin của non-admin, và luồng OIDC thật (không dựng được IdP ở đây).

## Ghi chú phạm vi

- Cả 3 nhóm A/B/C đã sửa, trừ nửa sau của A10 (xem đầu file). Chưa commit gì — đúng quy ước
  `CLAUDE.md` của `../metap` (giữ nguyên diff để chủ dự án review trước).
- Không verify bằng browser automation — đúng "Frontend verification policy (2026-08-11)". Toàn bộ
  kết luận về hình học ở phần A là tính lại bằng số từ chính công thức trong source, không phải
  nhìn ảnh chụp màn hình.
- B2 và C1 là việc ở repo `../metap`, không phải ở đây — chúng chặn việc sửa trọn vẹn B1 và
  A-nhóm-validator, nên được làm trước trong cùng đợt.
- **Việc còn lại cho chủ dự án**: regenerate `generated-types.ts` sau C1 (cần 1 demo app chạy), và
  nửa sau của A10.
