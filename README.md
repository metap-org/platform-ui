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

**Cố ý bỏ qua i18n ở một số file** — `ApiErrorMessage`/`AppShellLayout` hardcode tiếng Anh thay
vì `react-i18next`. Phần `i18n/*` (LocaleSwitcher, LocaleProvider, ...) và các trang còn lại vẫn
dùng `react-i18next` nguyên trạng như `platform-react`.

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
- Không có `Tree`/`TreeView` hay drag-and-drop primitive nào — cây điều kiện ABAC
  (`admin/policies/ConditionNodeEditor.tsx`) tự dựng đệ quy bằng indent + border trái, không
  dùng `Accordion` (chỉ là list phẳng, không hỗ trợ nesting thật).
- `DatePicker` chỉ chọn ngày, không có time component — dùng chung cho cả field kind `"date"`
  và `"datetime"`, mất phần giờ:phút:giây khi hiển thị/nhập (xem doc-comment trong
  `field/FieldInput.tsx`).
- Không có `useDebouncedValue` — viết tay, lặp lại cục bộ ở `field/ReferenceFieldInput.tsx` và
  `list/GeneratedList.tsx` (chấp nhận duplicate nhỏ, không tách file chung).
- Không có polymorphism kiểu `component={Link}`/`Anchor component={Link}` — mọi nav-link tự
  render `navAdapter.Link` (hoặc `<a>` thuần) với `className` từ `buttonVariants(...)` hoặc
  Tailwind text classes.
- `Button` không có prop `loading`/color `"red"` — dùng `Spinner` + `disabled`, hoặc
  `className="text-destructive hover:text-destructive"`.
- Không có `Container`/`Stack`/`Title`/`Group`/`Text`/`Divider`/`Center` — thay bằng div/flex
  Tailwind thuần.

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
