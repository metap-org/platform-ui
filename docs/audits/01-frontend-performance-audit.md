# Audit 01 — Kiến trúc & performance frontend (2026-08-29)

**Trạng thái (2026-08-31): tất cả 7 finding bên dưới đã được fix trong code, verify lại bằng cách
đọc trực tiếp source (không phải chỉ tin theo doc-comment) — xem dòng "**Đã xử lý**" ở đầu mỗi mục
để biết fix nằm ở đâu. Không còn việc gì mở ở audit này; giữ lại file làm lịch sử, session sau
không cần đọc lại để tìm việc.**

Review toàn bộ `src/` ở trạng thái hiện tại (không phải diff — git status có 2 file đang sửa dở
`AdvancedPoliciesPanel.tsx`/`i18n/resources.ts`, không liên quan tới audit này). Không sửa code —
chỉ report.

Phương pháp: đọc toàn bộ source (không skim) — list/form/detail generic renderer, toàn bộ trang
admin (`LowCodeEntitiesAdminPage`, `PermissionMatrix`, `AdvancedPoliciesPanel`, `UsersAdminPage`,
`CronJobsAdminPage`), field renderer, context (`AuthContext`/`LocaleContext`/`NavigationContext`),
api hooks (`useApiQuery`/`useApiMutation`/`useApiInfiniteQuery`). Đối chiếu với các pattern
React/state-management chuẩn: tránh re-render thừa (memoization, context value stability), tránh
N+1 network call, tách server-state (React Query) khỏi UI-state (`useState`).

Bối cảnh thêm: `platform-ui` được xác nhận sẽ là core UI cho 1 low-code platform nâng cao, sau này
có UI builder (kéo-thả) — một số finding LOW ở đây được giữ lại vì sẽ thành vấn đề thật khi builder
tới, dù chưa gây hại ở scope hiện tại.

## Tóm tắt ưu tiên xử lý

| #   | Mức độ                                   | Vị trí                                                                                            | Vấn đề                                                                                                                                                                                                               | Trạng thái  |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | **HIGH**                                 | `field/ReferenceFieldValue.tsx:16-21`                                                             | Mỗi cell reference field tự bắn 1 request `GET /api/{refEntity}/{id}` riêng — N+1 query, virtualized list scroll nhanh có thể tạo hàng chục request song song                                                        | ✅ Đã xử lý |
| 2   | **MEDIUM-HIGH**                          | `admin/policies/PermissionMatrix.tsx` + `policyMatrixHelpers.ts`                                  | State `desired` là 1 `Set<string>` toàn cục cho cả ma trận role×action — mỗi lần toggle 1 checkbox re-render toàn bảng, không có row-level `memo` như pattern đã áp dụng ở `LowCodeEntitiesAdminPage`                | ✅ Đã xử lý |
| 3   | **MEDIUM**                               | `workflow/WorkflowActionBar.tsx:75-78`                                                            | `computeLevels` (BFS) + `groupByLevel` + `transitionInfo` Map chạy lại mỗi render, kể cả khi chỉ `pendingAction`/`showBar` đổi — không `useMemo`                                                                     | ✅ Đã xử lý |
| 4   | **LOW** (forward-looking)                | `admin/LowCodeEntitiesAdminPage.tsx` — `FieldRowEditor`/`ListViewRowEditor`/`TransitionRowEditor` | Row key = index mảng (`key={index}`), không phải id ổn định — an toàn với add/remove-cuối-mảng hiện tại, nhưng sẽ vỡ (mất focus, lẫn state giữa row) ngay khi có drag-reorder — thứ UI builder gần như chắc chắn cần | ✅ Đã xử lý |
| 5   | **LOW**                                  | `field/ReferenceFieldInput.tsx:75-81`                                                             | `options` dựng bằng `new Map()` mới mỗi render, không `useMemo` — rẻ (≤11 phần tử) nhưng không nhất quán với phần còn lại của code                                                                                   | ✅ Đã xử lý |
| 6   | **LOW**                                  | `i18n/useEntityLabels.ts`                                                                         | Trả về closure mới (`entityLabel`/`fieldLabel`/`transitionLabel`) mỗi render, không `useCallback` — chưa gây hại vì chưa truyền vào component đã `memo`, nhưng là nợ kỹ thuật                                        | ✅ Đã xử lý |
| 7   | **LOW** (extensibility, forward-looking) | `field/FieldInput.tsx` + `field/fieldKindConfig.ts`                                               | Field-kind rendering là `switch` cứng, không phải registry/map — hợp lý với kind cố định hiện tại, nhưng UI builder sẽ cần liệt kê "widget khả dụng" động                                                            | ✅ Đã xử lý |

**Tất cả 7 mục đã fix (verify 2026-08-31 bằng cách đọc source, không chỉ tin doc-comment) — chi
tiết + vị trí fix thật ở mỗi mục dưới đây.**

---

## 1. [HIGH] N+1 query ở reference field — `field/ReferenceFieldValue.tsx:16-21`

**Đã xử lý** — `ReferenceFieldValue` giờ nhận `batchMode`/`displayValue` prop; khi
`GeneratedList` truyền `relatedDisplay` map, component trust thẳng `displayValue` đã batch-resolve
sẵn từ backend (`hydrate_related_display`), không fetch per-cell nữa. Chỉ `RecordDetail` (view 1
record, không có trang list để batch qua) vẫn fetch trực tiếp như cũ — đúng scope, không phải N+1.

```tsx
const { data: record } = useApiQuery<{ data: RecordDto }, RecordDto>(
  ["record", refEntity, id],
  `/api/${refEntity}/${id}`,
  (response) => response.data,
  Boolean(refEntity && id),
);
```

Component này render **1 lần cho mỗi cell** có field kind `reference` trong `GeneratedList`
(`list/GeneratedList.tsx`'s `<FieldValue>` trong virtualized row). Mỗi cell tự gọi API riêng để
resolve display label. React Query chỉ dedupe khi trùng `queryKey` (tức trùng `id`) — với danh
sách record khác nhau, mỗi row có `id` khác nhau nên không dedupe được gì. Với virtualizer
overscan 10 + 1-2 cột reference, mỗi lần cuộn tới dữ liệu mới có thể bắn 20-60 request song song
chỉ để hiện tên hiển thị của foreign key.

**Hướng sửa đúng kiến trúc:** chuyển việc resolve display label sang batch ở tầng data — hoặc (a)
backend embed sẵn resolved label trong response `GET /api/{entity}` (list), hoặc (b) thêm endpoint
batch `POST /api/{refEntity}/batch?ids=...` và gom toàn bộ id cần resolve của 1 trang list thành 1
request duy nhất ở `GeneratedList`, truyền xuống qua context/prop thay vì để mỗi cell tự fetch.

## 2. [MEDIUM-HIGH] `PermissionMatrix` re-render toàn bảng mỗi checkbox

**Đã xử lý** — `DesiredState` đổi thành `Map<string, Set<string>>` (1 `Set` riêng mỗi role, không
còn 1 `Set` toàn cục); `toggleCell`/`toggleRow`/`toggleColumn` chỉ thay reference của role bị đổi.
`PermissionMatrix.tsx` tách `RoleRow` thành component `memo`hoá riêng, nhận
`checkedActions={desired.get(role)}` + callback ổn định qua `useCallback` — đúng pattern
`FieldRowEditor` đã áp dụng.

`policyMatrixHelpers.ts`'s `toggleCell`/`toggleRow`/`toggleColumn` đều nhận và trả `Set<string>`
mới cho **toàn bộ ma trận**:

```ts
export function toggleCell(desired: Set<string>, role: string, action: string, checked: boolean): Set<string> {
  const next = new Set(desired);
  ...
  return next;
}
```

`PermissionMatrix.tsx` giữ `desired` này ở top-level component (`useState<Set<string>>`), không
có row nào được tách `memo`. Kết quả: click 1 checkbox → tạo `Set` mới → toàn bộ `roles.map(...)`
re-render, kể cả các role/action không liên quan. Với ma trận nhiều role (vài chục role × ~10
action = vài trăm checkbox), đây là đúng loại lag mà `LowCodeEntitiesAdminPage.tsx`'s
`FieldRowEditor` doc-comment đã mô tả và cố tình fix bằng `memo` + stable `useCallback`:

> "This is the fix for the multi-second lag reported when toggling required/searchable with
> several fields in the table — every checkbox click was re-rendering the entire table."

`PermissionMatrix` chưa áp dụng pattern tương tự.

**Hướng sửa:** tách 1 component row (`memo`hoá, nhận `role`, action list, và callback ổn định qua
`useCallback`) giống hệt pattern `FieldRowEditor`; hoặc đổi shape state từ 1 Set toàn cục sang
`Map<role, Set<action>>` để chỉ row bị đổi mới nhận reference mới.

## 3. [MEDIUM] BFS + Map không memo — `workflow/WorkflowActionBar.tsx:75-78`

**Đã xử lý** — `columns`/`terminalStates`/`availableTransitions`/`transitionInfo` đều bọc
`useMemo` với dep đúng như đề xuất (`[workflow]`, `[workflow, currentState]`, `[capabilities]`).

```tsx
const columns = groupByLevel(computeLevels(workflow));
const availableTransitions = workflow.transitions.filter((t) => t.from === currentState);
const terminalStates = new Set(workflow.terminalStates);
const transitionInfo = new Map(capabilities.transitions.map((t) => [t.action, t]));
```

Bốn dòng này chạy lại **mỗi lần component render**, kể cả khi chỉ local state (`pendingAction`,
`showBar`) đổi — tức chạy lại ngay khi user bấm nút transition (set `pendingAction`) hoặc bấm
show/hide (`showBar`). `computeLevels` là BFS toàn bộ transitions, không tốn nhiều với graph nhỏ,
nhưng không nhất quán với discipline `useMemo` mà phần còn lại của code áp dụng
(`GeneratedList`'s `fieldsByName`/`activeFilters`/`baseParams`, `LowCodeEntitiesAdminPage`'s
`fieldNames`). Sẽ đáng chú ý hơn khi workflow phức tạp hơn (nhiều state/transition) — hợp lý với
định hướng low-code platform sẽ có entity/workflow phong phú hơn.

**Hướng sửa:** bọc `useMemo` với dep `[workflow]` cho `columns`/`terminalStates`, dep
`[workflow, currentState]` cho `availableTransitions`, dep `[capabilities]` cho `transitionInfo`.

## 4. [LOW, forward-looking] Row key = index — `admin/LowCodeEntitiesAdminPage.tsx`

**Đã xử lý** — `FieldRowEditor`/`ListViewRowEditor`/`TransitionRowEditor` đều dùng `key={row.id}`
(id ổn định gán lúc tạo row), không còn `key={index}` ở file này.

`FieldBuilder`/`ListViewBuilder`/`WorkflowBuilder` đều render list bằng `key={index}`:

```tsx
fields.map((row, index) => (
  <FieldRowEditor key={index} row={row} index={index} onUpdate={updateRow} onRemove={removeRow} />
));
```

Không phải bug ở scope hiện tại (chỉ add-cuối-mảng/remove, không có reorder). Nhưng ghi nhận vì
UI builder tương lai (theo context user cung cấp) gần như chắc chắn cần kéo-thả sắp xếp lại
field/component — lúc đó `key={index}` sẽ làm React re-dùng nhầm DOM node giữa các row khi thứ tự
đổi, gây mất focus input đang gõ dở và/hoặc hiện sai state ở đúng vị trí cũ. Nên gán `id` ổn định
cho mỗi `FieldRow`/`ListViewRow`/`TransitionRow` (`crypto.randomUUID()` lúc tạo row) và dùng làm
key **trước khi** implement drag-reorder, để không phải refactor lại toàn bộ 3 builder cùng lúc.

## 5. [LOW] `options` Map rebuilt mỗi render — `field/ReferenceFieldInput.tsx:75-81`

**Đã xử lý** — `options` bọc `useMemo` với dep `[currentRecord, searchResults,
field.refDisplayField]`, kèm doc-comment trỏ ngược lại đúng finding #5 này.

```tsx
const options = new Map<string, string>();
if (currentRecord) {
  options.set(currentRecord.id, labelFor(currentRecord, field.refDisplayField));
}
for (const record of searchResults ?? []) {
  options.set(record.id, labelFor(record, field.refDisplayField));
}
```

Rebuilt mỗi render, không `useMemo`. Rẻ vì giới hạn ~11 phần tử (`limit=10` + current), không
phải vấn đề thật, chỉ nêu vì thiếu nhất quán với style memoization ở nơi khác.

## 6. [LOW] Closure mới mỗi render — `i18n/useEntityLabels.ts`

**Đã xử lý** — cả 3 hàm (`entityLabel`/`fieldLabel`/`transitionLabel`) đều bọc `useCallback`.

```ts
export function useEntityLabels(entityName: string) {
  const { locale } = useLocale();
  const overrides = entityLabelOverrides[locale]?.[entityName];
  return {
    entityLabel: (fallback: string) => overrides?.entity ?? fallback,
    fieldLabel: (fieldName: string, fallback: string) => overrides?.fields?.[fieldName] ?? fallback,
    transitionLabel: (action: string, fallback: string) =>
      overrides?.transitions?.[action] ?? fallback,
  };
}
```

3 hàm trả về là closure mới mỗi lần hook chạy — hiện tại không gây hại vì không có nơi nào truyền
các hàm này làm prop cho component đã `memo` (nên không phá memoization của ai). Nêu như nợ kỹ
thuật: nếu sau này 1 component con được `memo`hoá nhận `fieldLabel` làm prop, memoization đó sẽ
vô hiệu vì reference đổi mỗi lần cha render.

## 7. [LOW, extensibility] Field-kind dispatch bằng `switch` — `field/FieldInput.tsx`, `field/fieldKindConfig.ts`

**Đã xử lý** — cả hai đổi thành `Record<FieldKind, ...>` registry (`fieldKindConfig.ts`'s
`FORMATTERS`, `FieldInput.tsx`'s renderer map), không còn `switch (field.kind)`.

Cả input renderer (`FieldInput.tsx`) và value formatter (`fieldKindConfig.ts`'s
`formatFieldValue`) dispatch bằng `switch (field.kind)` cứng. Hợp lý với tập `FieldKind` cố định
hiện tại (không phải vấn đề performance). Ghi nhận vì UI builder sẽ muốn liệt kê "widget khả dụng"
động (palette kéo-thả) hoặc cho phép field kind mở rộng — lúc đó nên đổi thành
`Record<FieldKind, Component>`-style registry thay vì sửa switch ở nhiều file mỗi khi thêm kind
mới.

---

## Phần đã verify tốt (không phải finding)

- **Virtualization**: `list/GeneratedList.tsx` dùng `@tanstack/react-virtual` đúng cách, kèm
  fetch-ahead khi `lastVirtualIndex >= records.length - 10`.
- **Debounce filter**: text filter debounce 400ms trước khi refetch, tách riêng khỏi enum filter
  (refetch ngay, đúng vì đến từ `Select` không phải gõ tự do).
- **Server-state/UI-state tách bạch**: toàn bộ code dùng React Query cho server state
  (`useApiQuery`/`useApiMutation`/`useApiInfiniteQuery`), `useState` chỉ cho UI state cục bộ —
  đúng nguyên tắc, không cần Redux/Zustand ở scope hiện tại.
- **Context value ổn định**: `AuthContext`, `LocaleContext` đều `useMemo`/`useCallback` giá trị
  context, tránh re-render thừa cho consumer.
- **Query key sharing**: `PermissionMatrix` và `AdvancedPoliciesPanel` cùng key
  `["admin","policies",entity]` — mount cả 2 tab không tốn round-trip kép.
- **Row-level `memo` (nơi đã áp dụng)**: `LowCodeEntitiesAdminPage.tsx`'s `FieldRowEditor`,
  `ListViewRowEditor`, `TransitionRowEditor` — pattern chuẩn, nên nhân rộng sang finding #2.

## Ghi chú định hướng — chuẩn bị cho UI builder

Không phải finding performance, nhưng liên quan tới quyết định kiến trúc sắp tới (xác nhận với
user 2026-08-29): `platform-ui` sẽ là core UI cho 1 low-code platform nâng cao, có UI builder kéo-thả
sau này.

- State quản lý server-state/UI-state hiện tại (React Query + `useState`) **giữ nguyên** cho phần
  admin CRUD — không đổi trước khi cần.
- Canvas/selection/drag/undo-redo state của builder có shape khác hẳn — cần subscribe theo field
  để không re-render cả cây lúc kéo-thả 60fps, Context không đủ. Khi bắt đầu code builder, nên
  dùng 1 store riêng kiểu Zustand (khớp style hook nhỏ hiện có: `useAuth`, `useLocale`), cân nhắc
  middleware temporal (vd `zundo`) cho undo/redo thay vì tự viết history stack tay.
- Finding #4 và #7 ở trên nên được xử lý **trước khi** builder work bắt đầu, không phải sau — sửa
  sau khi đã có nhiều chỗ phụ thuộc vào index-key/switch cứng sẽ tốn hơn.
