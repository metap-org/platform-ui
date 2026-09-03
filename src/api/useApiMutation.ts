import { useMutation } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "./client";

export function useApiMutation<TResponse, TBody = unknown>(
  method: "POST" | "PATCH" | "PUT",
  path: string,
) {
  return useMutation<TResponse, ApiError, TBody>({
    mutationFn: (body: TBody) =>
      apiFetch<TResponse>(path, {
        method,
        body: JSON.stringify(body),
      }),
  });
}
