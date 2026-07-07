// Compare current schedule with previous week to show predictability score

import { worksOn, EMPTY_WEEK } from './scheduler';

export function compareWeeks(lastWeekSchedule, newSchedule, workers) {
  if (!lastWeekSchedule || Object.keys(lastWeekSchedule).length === 0) {
    return {
      similarityPercent: 0,
      message: 'No previous schedule to compare',
      workerChanges: {},
      newGaps: [],
    };
  }

  let totalSlots = 0;
  let identicalSlots = 0;
  const workerChanges = {};

  for (const w of workers) {
    const wId = w.id;
    const oldWeek = lastWeekSchedule[wId] || EMPTY_WEEK();
    const newWeek = newSchedule[wId] || EMPTY_WEEK();

    const changes = [];
    const sameShifts = [];

    for (let d = 0; d < 7; d++) {
      const oldSlot = oldWeek[d] || { am: null, pm: null };
      const newSlot = newWeek[d] || { am: null, pm: null };

      const oldWorks = worksOn(oldWeek, d);
      const newWorks = worksOn(newWeek, d);
      const sameAm = oldSlot.am === newSlot.am;
      const samePm = oldSlot.pm === newSlot.pm;

      // Track as full days for comparison
      if (oldWorks || newWorks) {
        totalSlots++;

        if (sameAm && samePm) {
          identicalSlots++;
          if (oldWorks) sameShifts.push(d);
        } else {
          changes.push(d);
        }
      }
    }

    if (changes.length > 0 || sameShifts.length > 0) {
      workerChanges[wId] = {
        name: w.name,
        changes,
        sameShifts,
      };
    }
  }

  const similarityPercent = totalSlots === 0 ? 0 : Math.round((identicalSlots / totalSlots) * 100);

  return {
    similarityPercent,
    identicalSlots,
    totalSlots,
    workerChanges,
    message: `${similarityPercent}% similar to last week`,
  };
}
