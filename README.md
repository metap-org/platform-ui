# @metap/platform-ui

Bản kế thừa `packages/platform-react` (repo `metap`), build lại UI bằng `@metap/ui` (repo
`../design-system`, Tailwind + Radix + shadcn-style) thay cho Mantine. Repo riêng, không nằm
trong pnpm workspace của `metap` — `@metap/ui` được link cục bộ qua `link:../design-system`
trong lúc cả hai repo cùng phát triển song song (chưa publish package nào lên registry).

## Nguyên tắc kiến trúc (chốt 2026-08-29)

**`platform-ui` không tự viết component/styling mới** — mọi UI atom (kể cả những cái nhỏ kiểu
"`@metap/ui` chưa có nên tự dựng tạm") phải thêm vào repo `design-system` (`@metap/ui`) rồi import
lại, không hand-roll trực tiếp ở đây. `platform-ui` chỉ **kết hợp** các component có sẵn của
`design-system` thành màn hình nghiệp vụ (list chung, detail chung, màn phân quyền...) — single
responsibility giữa 2 repo. Ba trường hợp đã dọn lại đúng nguyên tắc này ngay khi phát hiện: xem
mục "Gap đã biết" bên dưới (`TagsField`/`MultiFieldSelect` cũ đã xoá khỏi repo này, chuyển hẳn
thành `TagsInput`/`SuggestInput`/`MultiSelect` bên `design-system`). Việc đóng gói UI thuần tuý
logic-nghiệp-vụ (ví dụ đệ quy cây điều kiện ABAC ở `ConditionNodeEditor.tsx`, hay các `<div
className="flex ...">` bọc ngoài để bố cục — xem gạch đầu dòng Tree/TreeView bên dưới) vẫn ở lại
đây vì đó là composition của 1 tính năng cụ thể, không phải atom dùng lại được.

## Trạng thái (2026-08-28)

**Đã port 100% sang `@metap/ui`, gỡ hẳn `@mantine/*` khỏi `package.json`.** Toàn bộ
`admin/`, `api/`, `auth/`, `charts/`, `detail/`, `field/`, `form/`, `i18n/`, `list/`,
`metadata/`, `navigation/`, `shell/`, `workflow/` giờ chỉ còn phụ thuộc `@metap/ui` (không còn
import `@mantine/*` nào trong `src/` — vài chỗ nhắc "@mantine" chỉ còn trong doc-comment giải
thích gap lịch sử). `typecheck`/`lint`/`format:check` đều sạch.

**i18n đã đủ (2026-08-31)** — `ApiErrorMessage`/`AppShellLayout` trước đó hardcode tiếng Anh, giờ
đã chuyển sang `react-i18next` (key `error.*`/`shell.logout` đã có sẵn trong `i18n/resources.ts`
từ trước, chỉ chưa được 2 file này dùng tới). Toàn bộ `src/` giờ đi qua `react-i18next` như phần
còn lại của package.

**Gap đã biết giữa `@metap/ui` và Mantine** (đã xử lý bằng workaround, không phải thiếu sót):

- Ban đầu `@metap/ui` không có `MultiSelect`/`TagsInput` — từng tự viết `MultiFieldSelect` (trong
  `admin/LowCodeEntitiesAdminPage.tsx`) và `TagsField` (`shared/TagsField.tsx`) ngay tại
  `platform-ui`. **Đã dọn lại 2026-08-29** theo nguyên tắc kiến trúc ở trên: cả hai chuyển hẳn
  sang `design-system` thành `MultiSelect`/`TagsInput` thật (`@metap/ui`'s component-status.md),
  file cũ trong `platform-ui` đã xoá — nơi dùng giờ chỉ import `MultiSelect`/`TagsInput` từ
  `@metap/ui` (`admin/LowCodeEntitiesAdminPage.tsx`'s list-view fields/filters/enumValues/
  terminalStates, `admin/policies/ValueEditor.tsx`'s `in`/`notIn` operator).
- `Autocomplete` chỉ commit giá trị khi chọn 1 option có sẵn hoặc bấm clear — gõ text tự do
  không khớp option nào sẽ bị bỏ qua âm thầm (không phải combobox thật dù giao diện giống). Vì
  vậy `admin/policies/AttributePicker.tsx`'s context-attribute picker (giá trị tự do, không có
  danh sách cố định — `AUTH_CONTEXT_ENTITY`'s dynamic attributes không enumerate được từ FE)
  dùng `SuggestInput` (`@metap/ui`, thêm 2026-08-29 cùng đợt dọn ở trên — trước đó là `Input`+
  `Chip` viết tay ngay tại `platform-ui`) thay vì `Autocomplete`.
- ~~Không có `Tree`/`TreeView` hay drag-and-drop primitive nào~~ **Đã xử lý 2026-08-31** —
  `@metap/ui` thêm `TreeItem` (khung indent + border trái theo depth, không phải widget
  expand-collapse đầy đủ); `admin/policies/ConditionNodeEditor.tsx` chuyển sang dùng nó, vẫn tự sở
  hữu phần đệ quy `PolicyCondition` (domain data riêng, không có counterpart trong `@metap/ui`).
- ~~`DatePicker` chỉ chọn ngày, không có time component~~ **Đã xử lý 2026-08-31** — `@metap/ui`
  thêm `DateTimePicker` riêng (component tách biệt, không phải prop trên `DatePicker`, để
  `DatePicker` giữ nguyên là date-only cho caller chỉ cần ngày); field kind `"datetime"` giờ dùng
  `DateTimePicker` trong `field/FieldInput.tsx`, không còn mất phần giờ:phút:giây khi round-trip.
- ~~Không có `useDebouncedValue`, 2 bản viết tay lặp lại~~ **Đã xử lý 2026-08-31** — nhưng
  **không** chuyển vào `@metap/ui` (thử rồi revert cùng ngày: `@metap/ui` tự định phạm vi là
  component library, không phải hooks-utility library — xem `design-system/docs/component-status.md`
  infra-debt table). Hợp lý hơn: `platform-ui` tự nó là nơi chứa business/UI **logic** dùng chung
  cho application (`design-system` chỉ lo UI thuần, customize style), nên hook logic thuần thuộc về
  đây — gộp thành 1 bản chung tại `hooks/useDebouncedValue.ts` (không phải `shared/` — cả package
  này đã là tầng "shared" rồi, thư mục `shared/` con bên trong là thừa; `hooks/` nói đúng nó là gì),
  cả 2 call site cũ trong `platform-ui` lẫn 1 bản duplicate thứ 3 phát hiện ở `apps/jira-fe`'s
  `DashboardPage.tsx` (repo `metap`) đều đã chuyển sang import từ `@metap/platform-ui`.
- Polymorphism kiểu `component={Link}`: **`Button` đã có prop `asChild`** (2026-08-31, qua
  `@radix-ui/react-slot`) — nhưng **chưa retrofit** vào các nav-link hiện có
  (`shell/AppShellLayout.tsx`'s `NavLink`, `list/GeneratedList.tsx`/`detail/RecordDetail.tsx`'s
  view-link...) vẫn tự render `navAdapter.Link` với className từ `buttonVariants(...)` — chỉ mới
  là component sẵn sàng dùng, chưa phải đã dùng ở mọi chỗ.
- ~~`Button` không có prop `loading`/color `"red"`~~ **Đã xử lý 2026-08-31** — `@metap/ui`'s
  `Button` giờ có `variant="destructive"` và prop `loading` (built-in `Spinner` + tự `disabled`);
  mọi call site trong `platform-ui` đang ghép tay `<Spinner/>` + `disabled` đã chuyển sang dùng
  `loading` (xem `git log`/diff cho danh sách file).
- Không có `Container`/`Stack`/`Title`/`Group`/`Text`/`Divider`/`Center` — thay bằng div/flex
  Tailwind thuần. Đây là lựa chọn kiến trúc chủ đích (Tailwind-first), không phải gap cần xử lý.

## Toast notifications (2026-09-04)

`@metap/ui`'s `Toast`/`ToastProvider` tồn tại từ trước nhưng chưa có consumer nào trong repo này
dùng — `GeneratedForm`/`GeneratedList` chỉ báo lỗi (`Alert` inline), im lặng khi thành công.
`AppShellLayout` giờ mount `<ToastProvider>` bọc `children` (cùng shape "library tự cung cấp" với
`AuthContext`/`LocaleProvider`, không ép mọi consumer app tự wire provider) — `GeneratedForm` toast
`form.createSuccess`/`updateSuccess` sau khi tạo/sửa thành công, `GeneratedList` toast
`common.deleteSuccess` sau khi xoá. Không toast lỗi — lỗi đã có `Alert`/`deleteError` inline sẵn,
thêm toast sẽ trùng lặp thông tin.

## Component đã chuyển sang `design-system` (không còn ở đây)

Không phải "gap giữa `@metap/ui` và Mantine" (mục trên) — đây là các UI atom từng bị build nhầm ở
repo này, vi phạm "Nguyên tắc kiến trúc" đầu file, đã dọn theo đúng nguyên tắc đó ngay khi phát
hiện:

- `TagsField`/`MultiFieldSelect`/`Input`+`Chip` viết tay (xem mục "Gap đã biết" ở trên) → chuyển
  thành `TagsInput`/`SuggestInput`/`MultiSelect` (2026-08-29).
- `charts/BarChart.tsx` → chuyển thành `@metap/ui`'s `BarChart` (2026-09-01) — component thuần
  SVG, không biết `jira.issues` hay entity nào, chỉ nhận `{label, value, color?}`, không có lý do
  gì phải nằm ở tầng business-screen này. `apps/jira-fe`'s `DashboardPage.tsx`/
  `CustomizableDashboardPage.tsx` (2 consumer duy nhất) đổi import sang `@metap/ui`.

## State management cho UI builder tương lai (2026-08-31)

`src/builder/builderStore.ts` — scaffold rỗng (chưa có field state thật, chưa có UI builder nào
tiêu thụ) cho canvas/selection/drag/undo-redo state của low-code UI builder sau này. Dùng
**Zustand** (`zustand` + `zundo` cho undo/redo qua middleware `temporal`, `devtools` để inspect
qua Redux DevTools extension) — **không phải Redux**: đã cân nhắc lại 2026-08-31 và giữ nguyên
quyết định cũ (audit 2026-08-29), lý do chính là Zustand không cần `<Provider>` nên bundle vào
package này không ép mọi app tiêu thụ (`crm-fe`/`jira-fe`) phải tự wire provider chỉ để dùng
builder — xem doc-comment trong file đó. `docs/architectures/04-strategy/00-index.md`'s ADR (không global
store áp đặt lên app) vẫn đúng cho phần admin CRUD hiện có — store này tách biệt, chỉ phục vụ
builder chưa tồn tại.

## Lệnh

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format
```

Chưa có build/bundler riêng (không như `design-system` dùng `tsup` để publish) — giống
`platform-react`, package này được các app tiêu thụ trực tiếp từ `src/` qua bundler của app đó
(Vite), không cần build bước riêng.
