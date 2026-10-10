import { expect, test } from 'claude-code/testing'

import { isBackupRemote, remotesOf } from '../hooks/push'

const COMMANDS: { name: string; command: string; remotes: string[] }[] = [
  { name: 'jj の素の push', command: 'jj git push', remotes: ['origin'] },
  { name: 'jj で枝を指定', command: 'jj git push --bookmark main', remotes: ['origin'] },
  { name: 'jj でリモートを指定', command: 'jj git push --remote private --bookmark main', remotes: ['private'] },
  { name: 'jj でリモートを = で指定', command: 'jj git push --remote=upstream', remotes: ['upstream'] },
  { name: 'jj に全体のオプション', command: 'jj -R /repo git push', remotes: ['origin'] },
  { name: 'git の素の push', command: 'git push', remotes: ['origin'] },
  { name: 'git でリモートと枝を指定', command: 'git push upstream main', remotes: ['upstream'] },
  { name: 'git でオプションの後にリモート', command: 'git push --force-with-lease fork', remotes: ['fork'] },
  { name: 'git に -C', command: 'git -C /repo push', remotes: ['origin'] },
  { name: 'ほかのコマンドの後ろ', command: 'jj git fetch && jj git push --remote origin', remotes: ['origin'] },
  { name: '先頭に環境変数', command: 'GIT_SSH_COMMAND=ssh jj git push', remotes: ['origin'] },
  { name: '2 つの push', command: 'jj git push --remote private; jj git push', remotes: ['private', 'origin'] },
  { name: 'push でない jj', command: 'jj git fetch', remotes: [] },
  { name: 'push でない git', command: 'git log --grep push', remotes: [] },
  { name: 'push という語を含むだけ', command: 'echo jj git push', remotes: [] },
  { name: '空', command: '', remotes: [] },
]

for (const one of COMMANDS) {
  test(`remotesOf: ${one.name}`, async () => {
    expect(remotesOf(one.command)).toEqual(one.remotes)
  })
}

const BACKUPS: { remote: string; isBackup: boolean }[] = [
  { remote: 'private', isBackup: true },
  { remote: 'private-backup', isBackup: true },
  { remote: 'origin', isBackup: false },
  { remote: 'upstream', isBackup: false },
]

for (const one of BACKUPS) {
  test(`isBackupRemote("${one.remote}")`, async () => {
    expect(isBackupRemote(one.remote)).toBe(one.isBackup)
  })
}
