import { describe, expect, it } from 'vitest';
import { orderTeamRoles } from '../src/teams.js';

const edge = (fromRoleId: string, toRoleId: string) => ({ fromRoleId, toRoleId });

describe('orderTeamRoles', () => {
  it('follows the handoff chain even when the roster lists it backwards', () => {
    expect(orderTeamRoles(['reviewer', 'implementer', 'architect'], [
      edge('architect', 'implementer'),
      edge('implementer', 'reviewer'),
    ])).toEqual(['architect', 'implementer', 'reviewer']);
  });

  it('uses roster order as the tie-break for independent roles', () => {
    expect(orderTeamRoles(['builder', 'researcher'], [])).toEqual(['builder', 'researcher']);
    expect(orderTeamRoles(['implementer', 'architect'], [])).toEqual(['implementer', 'architect']);
  });

  it('resolves a diamond without duplicating a role', () => {
    expect(orderTeamRoles(['plan', 'left', 'right', 'ship'], [
      edge('plan', 'left'),
      edge('plan', 'right'),
      edge('left', 'ship'),
      edge('right', 'ship'),
    ])).toEqual(['plan', 'left', 'right', 'ship']);
  });

  it('ignores edges that name a role outside the roster', () => {
    expect(orderTeamRoles(['a', 'b'], [edge('a', 'stranger')])).toEqual(['a', 'b']);
  });
});
