import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type AgentTeam,
  agentTeamSchema,
  agentTeamCreateSchema,
  agentTeamUpdateSchema,
  slugifyTeamName,
  ensureUniqueTeamId,
} from '@agent-ops/agent-runtime';

export type CreateTeamInput = {
  name: string;
  description?: string;
  roleIds: string[];
  handoffs?: AgentTeam['handoffs'];
  budget?: AgentTeam['budget'];
  enabled?: boolean;
};

export type UpdateTeamInput = {
  name?: string;
  description?: string;
  roleIds?: string[];
  handoffs?: AgentTeam['handoffs'];
  budget?: AgentTeam['budget'];
  enabled?: boolean;
};

/** Only the fields the store checks; kept structural so the caller can pass RoleStore.getRole. */
export type TeamRoleLookup = (id: string) => Promise<{ id: string; enabled: boolean } | null>;

export type TeamStoreChange = {
  action: 'created' | 'updated' | 'deleted';
  team: AgentTeam;
};

/**
 * Teams live beside Roles and Profiles as a user-level JSON store. A team is a roster plus handoff
 * edges, so a single-user file keeps one source of truth while the model is still moving; a SQL table
 * can follow once Team queries need joins with Tasks.
 */
export class TeamStore {
  private readonly filePath: string;
  private readonly lookupRole: TeamRoleLookup;
  private readonly onChange?: (change: TeamStoreChange) => void | Promise<void>;
  private cache: AgentTeam[] | null = null;
  private corrupted = false;

  constructor(
    dataDirectory: string,
    lookupRole: TeamRoleLookup,
    onChange?: (change: TeamStoreChange) => void | Promise<void>,
  ) {
    this.filePath = join(dataDirectory, 'agent-teams.json');
    this.lookupRole = lookupRole;
    this.onChange = onChange;
  }

  async listTeams(): Promise<AgentTeam[]> {
    if (this.cache) return this.cache;
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  async getTeam(id: string): Promise<AgentTeam | null> {
    const teams = await this.listTeams();
    return teams.find(team => team.id === id) ?? null;
  }

  async createTeam(input: CreateTeamInput): Promise<AgentTeam> {
    const parsed = agentTeamCreateSchema.parse(input);
    await this.assertRolesUsable(parsed.roleIds);
    const existing = await this.listTeams();
    const id = ensureUniqueTeamId(slugifyTeamName(parsed.name), existing.map(team => team.id));
    const now = new Date().toISOString();
    const team: AgentTeam = {
      id,
      name: parsed.name,
      description: parsed.description,
      roleIds: parsed.roleIds,
      handoffs: parsed.handoffs,
      budget: parsed.budget,
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now,
    };
    // Parse the complete record too: the create schema would accept a hand-edited field that the
    // stored shape rejects, and that must fail before it reaches disk.
    agentTeamSchema.parse(team);
    existing.push(team);
    await this.saveToDisk(existing);
    this.cache = existing;
    await this.onChange?.({ action: 'created', team });
    return team;
  }

  async updateTeam(id: string, input: UpdateTeamInput): Promise<AgentTeam | null> {
    const parsed = agentTeamUpdateSchema.parse(input);
    const teams = await this.listTeams();
    const index = teams.findIndex(team => team.id === id);
    if (index === -1) return null;

    const updated: AgentTeam = {
      ...teams[index],
      ...parsed,
      handoffs: parsed.handoffs ?? teams[index].handoffs,
      roleIds: parsed.roleIds ?? teams[index].roleIds,
      updatedAt: new Date().toISOString(),
    };
    agentTeamSchema.parse(updated);
    await this.assertRolesUsable(updated.roleIds);
    teams[index] = updated;
    await this.saveToDisk(teams);
    this.cache = teams;
    await this.onChange?.({ action: 'updated', team: updated });
    return updated;
  }

  async deleteTeam(id: string): Promise<boolean> {
    const teams = await this.listTeams();
    const index = teams.findIndex(team => team.id === id);
    if (index === -1) return false;
    const [removed] = teams.splice(index, 1);
    await this.saveToDisk(teams);
    this.cache = teams;
    if (removed) await this.onChange?.({ action: 'deleted', team: removed });
    return true;
  }

  private async assertRolesUsable(roleIds: string[]): Promise<void> {
    for (const roleId of roleIds) {
      const role = await this.lookupRole(roleId);
      if (!role) throw new Error(`Role ${roleId} was not found.`);
      if (!role.enabled) throw new Error(`Role ${roleId} is disabled.`);
    }
  }

  private async loadFromDisk(): Promise<AgentTeam[]> {
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
        `[TeamStore] ${this.filePath} is corrupted or not a JSON array; serving an empty team list and refusing writes until the file is repaired or removed`,
      );
      return [];
    }
    return parsed
      .map(item => {
        try {
          return agentTeamSchema.parse(item);
        } catch {
          return null;
        }
      })
      .filter((team): team is AgentTeam => team !== null);
  }

  private async saveToDisk(teams: AgentTeam[]): Promise<void> {
    if (this.corrupted) {
      throw new Error(
        `Refusing to overwrite ${this.filePath}: the existing teams file is corrupted. Repair or remove it manually, then retry.`,
      );
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(teams, null, 2) + '\n', 'utf8');
    await rename(tmpPath, this.filePath);
  }
}
