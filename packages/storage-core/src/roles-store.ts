import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type AgentRole,
  agentRoleSchema,
  agentRoleCreateSchema,
  agentRoleUpdateSchema,
  slugifyRoleName,
  ensureUniqueRoleId,
} from '@agent-ops/agent-runtime';

export type CreateRoleInput = {
  name: string;
  description?: string;
  baseAgentId?: string;
  profileId?: string;
  systemPrompt?: string;
  acceptanceCriteria?: string[];
  runtimePolicy?: AgentRole['runtimePolicy'];
  enabled?: boolean;
};

export type UpdateRoleInput = {
  name?: string;
  description?: string;
  baseAgentId?: string;
  profileId?: string;
  systemPrompt?: string;
  acceptanceCriteria?: string[];
  runtimePolicy?: AgentRole['runtimePolicy'];
  enabled?: boolean;
};

/**
 * Roles are user-level, like Profiles: one Role can be selected by any task on this machine.
 * The file is kept beside the SQLite database and uses the same atomic-replace/corruption policy
 * as ProfileStore. A SQL table can follow when Team/Pipeline need relational queries; until then
 * a single-user JSON store avoids a second source of truth while the model is still moving.
 */
export class RoleStore {
  private readonly filePath: string;
  private cache: AgentRole[] | null = null;
  private corrupted = false;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'agent-roles.json');
  }

  async listRoles(): Promise<AgentRole[]> {
    if (this.cache) return this.cache;
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  async getRole(id: string): Promise<AgentRole | null> {
    const roles = await this.listRoles();
    return roles.find(role => role.id === id) ?? null;
  }

  async getRolesByBaseAgent(baseAgentId: string): Promise<AgentRole[]> {
    const roles = await this.listRoles();
    return roles.filter(role => role.baseAgentId === baseAgentId);
  }

  async createRole(input: CreateRoleInput): Promise<AgentRole> {
    const parsed = agentRoleCreateSchema.parse(input);
    const existing = await this.listRoles();
    const existingIds = existing.map(role => role.id);
    const id = ensureUniqueRoleId(slugifyRoleName(parsed.name), existingIds);
    const now = new Date().toISOString();
    const role: AgentRole = {
      id,
      name: parsed.name,
      description: parsed.description,
      baseAgentId: parsed.baseAgentId,
      profileId: parsed.profileId,
      systemPrompt: parsed.systemPrompt,
      acceptanceCriteria: parsed.acceptanceCriteria,
      runtimePolicy: parsed.runtimePolicy,
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now,
    };
    // Parse the complete record too: this catches a hand-edited field that the create schema would
    // accept but the stored shape would reject, before it reaches disk.
    agentRoleSchema.parse(role);
    existing.push(role);
    await this.saveToDisk(existing);
    this.cache = existing;
    return role;
  }

  async updateRole(id: string, input: UpdateRoleInput): Promise<AgentRole | null> {
    const parsed = agentRoleUpdateSchema.parse(input);
    const roles = await this.listRoles();
    const index = roles.findIndex(role => role.id === id);
    if (index === -1) return null;

    const updated: AgentRole = {
      ...roles[index],
      ...parsed,
      runtimePolicy: parsed.runtimePolicy ?? roles[index].runtimePolicy,
      updatedAt: new Date().toISOString(),
    };
    agentRoleSchema.parse(updated);
    roles[index] = updated;
    await this.saveToDisk(roles);
    this.cache = roles;
    return updated;
  }

  async deleteRole(id: string): Promise<boolean> {
    const roles = await this.listRoles();
    const index = roles.findIndex(role => role.id === id);
    if (index === -1) return false;
    roles.splice(index, 1);
    await this.saveToDisk(roles);
    this.cache = roles;
    return true;
  }

  private async loadFromDisk(): Promise<AgentRole[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!Array.isArray(parsed)) {
      this.corrupted = true;
      console.warn(
        `[RoleStore] ${this.filePath} is corrupted or not a JSON array; serving an empty role list and refusing writes until the file is repaired or removed`,
      );
      return [];
    }
    return parsed
      .map(item => {
        try {
          return agentRoleSchema.parse(item);
        } catch {
          return null;
        }
      })
      .filter((role): role is AgentRole => role !== null);
  }

  private async saveToDisk(roles: AgentRole[]): Promise<void> {
    if (this.corrupted) {
      throw new Error(
        `Refusing to overwrite ${this.filePath}: the existing roles file is corrupted. Repair or remove it manually, then retry.`,
      );
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(roles, null, 2) + '\n', 'utf8');
    await rename(tmpPath, this.filePath);
  }
}
