# @metap/platform-ui

Bản kế thừa `packages/platform-react` (repo `metap`), build lại UI bằng `@ui/ui-lib` (repo
`../design-system`, Tailwind + Radix + shadcn-style) thay cho Mantine. Repo riêng, không nằm
trong pnpm workspace của `metap` — `@ui/ui-lib` được link cục bộ qua `link:../design-system`
trong lúc cả hai repo cùng phát triển song song (chưa publish package nào lên registry).

## Trạng thái (2026-08-28)

**Đã port 100% sang `@ui/ui-lib`, gỡ hẳn `@mantine/*` khỏi `package.json`.** Toàn bộ
`admin/`, `api/`, `auth/`, `charts/`, `detail/`, `field/`, `form/`, `i18n/`, `list/`,
`metadata/`, `navigation/`, `shell/`, `workflow/` giờ chỉ còn phụ thuộc `@ui/ui-lib` (không còn
import `@mantine/*` nào trong `src/` — vài chỗ nhắc "@mantine" chỉ còn trong doc-comment giải
thích gap lịch sử). `typecheck`/`lint`/`format:check` đều sạch.

**Cố ý bỏ qua i18n ở một số file** — `ApiErrorMessage`/`AppShellLayout` hardcode tiếng Anh thay
vì `react-i18next`. Phần `i18n/*` (LocaleSwitcher, LocaleProvider, ...) và các trang còn lại vẫn
dùng `react-i18next` nguyên trạng như `platform-react`.

**Gap đã biết giữa `@ui/ui-lib` và Mantine** (đã xử lý bằng workaround, không phải thiếu sót):

- Không có `MultiSelect`/`TagsInput` — tự viết `MultiFieldSelect`/`TagsField` (trong
  `admin/LowCodeEntitiesAdminPage.tsx`) dựng từ `Badge` + `Select`/input thuần.
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
