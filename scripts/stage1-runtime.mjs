import { spawnSync } from 'node:child_process';
export function podmanImage(tag = 'localhost/tuig-stage1:ledger-lite-v1') {
  const result = spawnSync('podman', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0 || !/^[a-f0-9]{64}$/.test(result.stdout.trim())) throw Error('Verified Stage 1 Podman image is unavailable.');
  return result.stdout.trim();
}
export function isolatedCommand(image, workspace, args, oracle) {
  if (process.platform !== 'linux') throw Error('Stage 1 isolation requires Linux/WSL.');
  return ['/usr/bin/podman', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'all', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--userns', 'keep-id', '--user', process.getuid() + ':' + process.getgid(), '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--env', 'PYTHONPATH=/workspace', '--workdir', '/workspace', '--volume', workspace + ':/workspace:' + (oracle ? 'ro' : 'rw'), ...(oracle ? ['--volume', oracle + ':/oracle:ro'] : []), image, ...args];
}
