// human_editのUI手段を差し替えるための境界。tmux + editorは最初の実装にすぎず、
// Claude Code内蔵editor・デスクトップeditorへ替えてもhuman-edit.tsは変わらない。

export type EditRequest = {
  absolutePath: string
  cwd: string
  editor: string
  instructions?: string
  /** 開いたときにカーソルを置く行（1 始まり） */
  line?: number
}

export type EditOutcome =
  | { kind: 'exited'; exitCode: number }
  /** paneが閉じられた・中断された等、終了コードを得られなかった */
  | { kind: 'cancelled' }

export type HumanEditBackend = {
  name: string
  /** ユーザーが編集を終えるまでresolveしない */
  edit: (request: EditRequest, signal: AbortSignal) => Promise<EditOutcome>
}
