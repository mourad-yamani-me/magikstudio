// The suite a game runs against its own content pack.
//
// The failure mode of a bad pack is not a crash. It is a level that cannot be
// solved, discovered by a player, three weeks after release, in a review. Unit
// tests will not find it: they test the code, and the code is faithfully
// rendering an impossible board.
//
// So these check things that must be true of ANY game built on the engine, and
// they live in the ENGINE, not in the game. A copy of the suite in each app is
// a copy that drifts, and the sibling whose copy is stale is precisely the one
// that ships the broken pack.
//
// A game's whole test file is therefore:
//
//     import { describeGameShell } from '@your-scope/engine/testing'
//     describeGameShell(import.meta.url)
//
// import.meta.url rather than a path, so a game does not have to know how deep
// its own test file sits. The day that changes, it changes in one place.

import { describe, it, expect } from 'vitest';
import { appDirOf, readPack, readBrand } from './paths.js';
import { walk, summarise } from './walk.js';

export const describeGameShell = (testFileUrl) => {
  const appDir = appDirOf(testFileUrl);
  describeShell(appDir);
  describePackDeclaration(appDir);
  describeOpeningLayout(appDir);
  describeBoardWalk(appDir);
};

/**
 * The shell still holds nothing but identity.
 *
 * Structural, and the reason it is worth a test: this is what stops "just this
 * once, for this game" from quietly becoming a second codebase.
 */
export const describeShell = (appDir) =>
  describe('shell', () => {
    it('contains only identity — no components, store or game logic', () => {
      const files = listSource(appDir);
      expect(files.sort()).toEqual(['src/brand.js', 'src/main.jsx']);
    });
  });

/**
 * brand.json is honest about the pack it points at.
 *
 * Quiet when wrong: the leaderboard ceiling is stageCount * 3, so an inflated
 * count creates a score nobody can reach and a deflated one truncates the
 * campaign. Neither throws.
 */
export const describePackDeclaration = (appDir) =>
  describe('pack declaration', () => {
    it('stageCount matches the catalogue on disk', () => {
      const brand = readBrand(appDir);
      const { catalog } = readPack(appDir, brand);
      expect(brand.content.stageCount).toBe(catalog.stages.length);
    });
  });

/**
 * Every opening arrangement is legible, and is not the answer.
 *
 * The scramble rule is re-checked HERE, against the shipped data, in a third
 * implementation — the solver has one and the runtime fallback dealer has one.
 * Three, because it is the constraint whose violation is invisible in a
 * screenshot and obvious the moment a player notices it.
 *
 * A piece's implied board origin is `seat - home`. Two pieces sharing an origin
 * are sitting in their solved relationship, which hands the player part of the
 * answer. Pieces that are not neighbours in the solution are left alone: at
 * their home offset they do not touch, so there is nothing there to read.
 */
export const describeOpeningLayout = (appDir) =>
  describe('opening layout', () => {
    it('no two filled cells overlap, and nothing overlaps the board', () => {
      for (const board of eachBoard(appDir)) {
        expect(overlappingCellPairs(board)).toBe(0);
      }
    });

    it('no two solution-neighbours share an implied origin', () => {
      for (const board of eachBoard(appDir)) {
        for (const [a, b] of neighbourPairs(board)) {
          expect(originOf(a)).not.toEqual(originOf(b));
        }
      }
    });
  });

/**
 * Every board can be walked to a solve — and the shipped metrics are true.
 *
 * The second assertion is the one worth copying. Three numbers ride on every
 * board, written months ago by a different implementation in another repo. The
 * runtime walk recomputes them and they must match exactly.
 *
 * That single check ties together the generator's difficulty model, the ratings
 * the campaign order is built from, the power-ups that use the walk, and the
 * coin rewards priced off the decision load. If any one drifts from the others
 * the game keeps working and starts LYING — prices stop matching difficulty, a
 * level rated 8.1 plays like a 4, and nothing throws.
 *
 * Deliberately not sampled. A sampled content check is a check that passes on
 * the run where it mattered: the interesting board is always the one you did
 * not draw.
 */
export const describeBoardWalk = (appDir) =>
  describe('board walk', () => {
    it('every board walks to a complete solve', () => {
      for (const board of eachBoard(appDir)) {
        const steps = walk(board);
        expect(steps.length).toBe(board.pieces.length);
      }
    });

    it('reproduces the metrics the generator shipped', () => {
      for (const board of eachBoard(appDir)) {
        const m = summarise(walk(board));
        expect(m.forced).toBeCloseTo(board.metrics.forcedShare, 9);
        expect(m.avg).toBeCloseTo(board.metrics.averageChoices, 9);
        expect(m.worst).toBe(board.metrics.hardestStep);
      }
    });
  });

// What this suite cannot tell you, and a green run is persuasive enough that it
// is worth writing down: whether a level is GOOD. Solvable, legible, correctly
// rated and fairly priced are all machine-checkable. Satisfying is not.
