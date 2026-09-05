import { useMutation } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "./client";

/** `extraOptions` — an escape hatch for a caller that needs react-query lifecycle hooks this
 *  generic wrapper doesn't expose params for (`onMutate`/`onError`/`onSettled`, for the
 *  optimistic-update pattern `GeneratedForm`'s update mutation uses —
 *  `docs/features/19-generated-form-mutation-ergonomics.md`). `mutationFn` isn't overridable
 *  through it — every call still goes through `apiFetch` the same way. */
export function useApiMutation<TResponse, TBody = unknown, TContext = unknown>(
  method: "POST" | "PATCH" | "PUT",
  path: string,
  extraOptions?: Omit<UseMutationOptions<TResponse, ApiError, TBody, TContext>, "mutationFn">,
) {
  return useMutation<TResponse, ApiError, TBody, TContext>({
    mutationFn: (body: TBody) =>
      apiFetch<TResponse>(path, {
        method,
        body: JSON.stringify(body),
      }),
    ...extraOptions,
  });
}
