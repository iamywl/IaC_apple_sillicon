import { Client } from 'ssh2';
import { getSshCredentials } from '../config.js';

class SshPool {
  private connections = new Map<string, Client>();
  private connecting = new Map<string, Promise<Client>>();

  async exec(ip: string, command: string, timeoutMs = 8000): Promise<string> {
    const client = await this.getConnection(ip);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSH command timeout on ${ip}: ${command}`));
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          this.connections.delete(ip);
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', () => {
          clearTimeout(timer);
          resolve(stdout);
        });
        stream.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    });
  }

  private async getConnection(ip: string): Promise<Client> {
    const existing = this.connections.get(ip);
    if (existing) return existing;

    const inProgress = this.connecting.get(ip);
    if (inProgress) return inProgress;

    const promise = this.connect(ip);
    this.connecting.set(ip, promise);
    try {
      const client = await promise;
      return client;
    } finally {
      this.connecting.delete(ip);
    }
  }

  private connect(ip: string): Promise<Client> {
    const { user, password } = getSshCredentials();
    return new Promise((resolve, reject) => {
      const client = new Client();
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error(`SSH connect timeout to ${ip}`));
      }, 10000);

      client.on('ready', () => {
        clearTimeout(timer);
        this.connections.set(ip, client);
        resolve(client);
      });
      client.on('error', (err) => {
        clearTimeout(timer);
        this.connections.delete(ip);
        reject(err);
      });
      client.on('close', () => {
        this.connections.delete(ip);
      });
      client.connect({
        host: ip,
        port: 22,
        username: user,
        password: password,
        readyTimeout: 10000,
        keepaliveInterval: 15000,
      });
    });
  }

  closeAll() {
    for (const [ip, client] of this.connections) {
      client.end();
      this.connections.delete(ip);
    }
  }
}

export const sshPool = new SshPool();
