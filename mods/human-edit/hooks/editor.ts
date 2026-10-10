export type EditorEnv = {
  HUMAN_EDIT_EDITOR?: string
  VISUAL?: string
  EDITOR?: string
}

/**
 * 空文字を返したらwrapper側でnvim → vim → viの順に探す。
 * WHY wrapper側: どれが入っているかはpaneのPATHで決まり、modの環境からは判定できない。
 */
export const pickEditor = (env: EditorEnv): string =>
  [env.HUMAN_EDIT_EDITOR, env.VISUAL, env.EDITOR]
    .map(value => value?.trim() ?? '')
    .find(value => value !== '') ?? ''
