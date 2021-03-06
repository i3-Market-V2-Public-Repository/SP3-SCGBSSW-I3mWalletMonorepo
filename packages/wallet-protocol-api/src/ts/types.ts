
export type Params = Record<string, string> | undefined
export type Body = any

export interface ApiMethod {
  path: string
  method: string
  headers?: Record<string, string>
}

export interface ApiExecutor {
  executeQuery: <T>(api: ApiMethod, pathParams: Params, queryParams: Params, bodyObject: Body) => Promise<T>
}
