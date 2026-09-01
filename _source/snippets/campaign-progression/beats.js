// The rhythm: a twenty-beat cycle, and what each slot is for.
//
// Every slot has a `tone` saying what it is for and an `aim` placing it inside
// that tone's window (see tones.js).
//
// THE ORDER MATTERS AS MUCH AS THE COUNTS. Beat 11 is a challenge and beat 12
// the milestone, because the shape wanted is escalation *into* the major
// challenge. With a comfort beat in slot 11 the milestone had to climb out of a
// dip, the anti-oscillation cap held it down, and only four of eighteen
// milestones ended up being the hardest board anywhere near them. A milestone
// easier than the level before it is not a milestone, it is a lie with a badge.

export const RHYTHM = {
  // 12 comfort, 5 challenge, 2 recovery, 1 milestone = 60 / 25 / 10 / 5.
  beats: [
    { tone: 'comfort',   aim: 0.35 },
    { tone: 'comfort',   aim: 0.55 },
    { tone: 'challenge', aim: 0.40 },
    { tone: 'comfort',   aim: 0.15 },
    { tone: 'comfort',   aim: 0.60 },
    { tone: 'challenge', aim: 0.55 },
    { tone: 'recovery',  aim: 0.45 },
    { tone: 'comfort',   aim: 0.30 },
    { tone: 'comfort',   aim: 0.70 },
    { tone: 'challenge', aim: 0.75 },
    { tone: 'comfort',   aim: 0.25 },
    { tone: 'challenge', aim: 0.90 },
    { tone: 'milestone', aim: 0.60 },
    { tone: 'recovery',  aim: 0.15 },
    { tone: 'comfort',   aim: 0.40 },
    { tone: 'comfort',   aim: 0.65 },
    { tone: 'comfort',   aim: 0.55 },
    { tone: 'comfort',   aim: 0.20 },
    { tone: 'challenge', aim: 0.85 },
    { tone: 'comfort',   aim: 0.45 },
  ],

  // The target distribution the beat plan above has to produce. Worth asserting
  // in a report rather than trusting: it is easy to retune one beat and quietly
  // move the mix.
  mix: { comfort: 0.6, challenge: 0.25, recovery: 0.1, milestone: 0.05 },
};
