# Feature Guide — Phases 1, 2, 3

## Quick Start: Using the New Features

### Phase 1: Predictability Score 📊

**Where to find it**: Step 4 (Schedule view), at the top

**What it shows**:
```
┌─────────────────────────────────┐
│ 📊 Schedule Similarity: 78%     │
│ • 12 workers same as last week  │
│ • 3 workers have new shifts     │
│ ⓘ Click "Worker changes" to see │
│   which shifts are new          │
└─────────────────────────────────┘
```

**Status badges**:
- 🔵 **Draft** — Schedule can still be edited
- 🟢 **Finalized** — Schedule is locked

**How to use it**:
1. Generate a schedule → predictability appears automatically
2. Check the % — 90%+ means very little change, good for continuity
3. Click "Worker changes" to see who's doing different shifts this week
4. If the score seems too low, hit "Regenerate" to try again
5. Use it to validate the auto-generation made sense

---

### Phase 2: Manual Split Shifts ✂️

**Where to find it**: Step 4 (Schedule view), on each full-day cell

**What it looks like**:
```
┌─────────────────┐
│ Alice (full)    │
│ [✂️ button]      │
└─────────────────┘
```

**How to use it**:

1. **Spot a day that needs splitting** (e.g., Store A needs morning coverage but only evening is assigned)
2. **Click the ✂️ button** on that cell
3. **Split Shift modal opens**:
   ```
   Split shift — Store A · Monday
   
   Morning 8am–2pm:        Evening 2pm–10pm:
   ┌──────────────┐        ┌──────────────┐
   │ Alice        │        │ Alice        │
   └──────────────┘        └──────────────┘
   
   [Choose workers below]
   
   ☑ Alice [AM] [PM]
   ☐ Bob   [AM] [PM]
   ☐ Carlos [AM] [PM]
   ```
4. **Click AM or PM button** next to the worker you want
   - Green highlight = selected for that half
5. **Click "Done"** → shift now shows two workers
6. **Can undo**: Click ✂️ again to re-split or merge back to one worker

**Key points**:
- Only available on **full-day shifts** (same worker AM & PM)
- Already-split shifts (different AM/PM) have no ✂️ button
- No changeover time is asked upfront — split only when needed
- Can split the same shift multiple times if you change your mind

---

### Phase 3: Finalization Workflow 🔒

**The flow**:

```
1. DRAFT — Schedule is generated/edited
   ↓
2. REVIEW — Manager checks predictability, tweaks shifts, splits as needed
   ↓
3. FINALIZE — Manager clicks "✓ Finalize Schedule"
   ↓
4. CONFIRMATION — Modal appears, manager confirms
   ↓
5. FINALIZED — Schedule is locked, badge shows "Finalized"
```

**Finalize button** (appears at Step 4):
```
[← Back] [Regenerate] [Print] [✓ Finalize Schedule]
```

**Confirmation modal**:
```
╔════════════════════════════════════╗
║ Finalize schedule?                 ║
║                                    ║
║ Similarity to last week: 78%        ║
║ Shifts assigned: 45 of 56           ║
║ Week starting: Jan 27, 2025         ║
║                                    ║
║ ✓ Review complete                  ║
║ ✓ All gaps are acceptable          ║
║ ✓ Ready to publish                 ║
║                                    ║
║ [Keep editing] [Finalize Now]      ║
╚════════════════════════════════════╝
```

**After finalization**:
- Schedule shows 🟢 **Finalized** badge
- Cannot accidentally re-save different shifts
- If you edit → reverts to 🔵 **Draft** (can finalize again)

**Why finalize?**
- Prevents accidental overwrites after the schedule is published
- Creates an audit trail (timestamp shows when it was locked)
- Forces a deliberate "moment of truth" before committing

---

## Workflow Examples

### Example 1: Using Predictability for Validation

**Scenario**: New schedule generated, manager wants to check if it makes sense

1. Generate schedule (Step 3 → Step 4)
2. **See predictability card**: "85% similar to last week"
3. **Interpretation**: Great! Most people are doing their usual shifts, just a few changes to cover gaps
4. **Review "Worker changes"**: 2 workers have different shifts this week
5. **Decision**: 85% is good, accept this schedule
6. **Finalize**: Click "✓ Finalize Schedule" → confirm → done

---

### Example 2: Manually Splitting a Shift

**Scenario**: Generated schedule has Carlos full-time at Store B, but Store B needs someone else in the morning for training

1. View generated schedule (Step 4)
2. See: **Store B Monday → Carlos (full day)**
3. Click ✂️ button
4. **Split Shift modal shows**:
   - Morning: Carlos
   - Evening: Carlos
5. **Click "AM" next to Alice** → Morning now has Alice
6. **Click "Done"**
7. Now Store B Monday shows:
   - Morning: Alice ✓
   - Evening: Carlos ✓
8. Carlos still has 5 days, Alice gets one extra morning — everyone happy!

---

### Example 3: Editing Before Finalizing

**Scenario**: Manager looks at finalized draft, decides to swap two people

1. View schedule (Step 4, showing 🔵 Draft badge)
2. Click on Store A Tuesday
3. **Reassign modal opens** (existing feature)
4. Swap Alice ↔ Bob
5. Schedule updates, still shows 🔵 Draft
6. **Manager changes mind**: Click to re-swap them back
7. **Once satisfied**: Click "✓ Finalize Schedule" → confirm
8. Badge changes to 🟢 Finalized

---

### Example 4: Regenerating vs. Editing

| Action | Result | Schedule Status |
|--------|--------|-----------------|
| Generate schedule | New schedule created | 🔵 Draft |
| Click "Regenerate" | Auto-generates from scratch | 🔵 Draft |
| Manually edit shift | Update predictability | 🔵 Draft |
| Finalize | Lock schedule | 🟢 Finalized |
| Edit finalized schedule | Revert to draft | 🔵 Draft |
| Finalize again | Lock again | 🟢 Finalized |

---

## Tips & Tricks

### Predictability Score Interpretation

- **90-100%**: Excellent continuity, people doing their usual shifts
- **70-89%**: Good, most shifts are stable with necessary changes
- **50-69%**: Moderate changes, some workers will have different patterns
- **<50%**: Significant changes, double-check auto-generation didn't miss something

### When to Split Shifts

**Good reasons to split**:
- Training/onboarding (experienced worker in morning, trainee in evening)
- Coverage gap (auto-gen missed a store half, reassign someone)
- Cross-training (person works different stores in AM/PM)
- Fatigue (split one person across two half-shifts instead of full day)

**Bad reasons to split** (just edit instead):
- Change one worker to another → use reassign modal
- Correct a mistake → edit and regenerate
- Just prefer a different person → use reassign modal

### Finalization Best Practices

1. **Review in stages**:
   - Check predictability score
   - Look for red "OPEN" gaps
   - Expand worker changes
   - Print by worker for team review

2. **Tweak in draft mode**:
   - Split shifts where needed
   - Reassign to close gaps
   - Get team feedback (if not final yet)

3. **Final review**:
   - All gaps acceptable?
   - All splits make sense?
   - Worker coverage looks good?
   - No unintended changes?

4. **Finalize**:
   - Click "✓ Finalize Schedule"
   - Read the confirmation modal
   - Click "Finalize Now"
   - Done! Schedule is locked

---

## Troubleshooting

### Predictability card not showing?
- Make sure you loaded a previous week (auto-filled in "Who worked last week?")
- If first week, no historical data → card says "No previous schedule to compare"

### Split button not appearing?
- Only shows on **full-day shifts** (same worker AM & PM)
- Already-split days have AM & PM on separate rows → no button
- Floating workers show as "Full" when they have the same store AM & PM

### Finalize button greyed out?
- Usually not greyed out, but check cloud connection (blue status badge, top-right)
- If "Cloud error" → fix connection first, then try again

### Can I undo a finalization?
- Yes! Edit any shift → schedule reverts to 🔵 Draft
- Then make your changes and finalize again when ready

### Does finalized mean I can't print it?
- No, finalized schedules can still be printed
- Finalized just means "approved" — you can view/print anytime
- To prevent accidental edits to a locked schedule, don't edit it

---

## Video Walkthrough (Mental Model)

```
✂️ SCISSORS  = "I want to split this one shift into AM/PM"
🔵 DRAFT     = "This schedule is still being worked on"
🟢 FINALIZED = "This schedule is approved and locked"
📊 SCORE     = "How different is today's schedule from last week?"
```

Flow:
1. Generate (auto) → See predictability score
2. Split (manual) → Adjust individual shifts as needed
3. Finalize (explicit) → Lock and confirm

---

## For Managers: Daily Workflow

**Monday morning, building next week's schedule**:

1. **Step 1**: Configure week (same as before)
2. **Step 2**: Name stores & workers (same as before)
3. **Step 3**: Last week's worked days (auto-filled from history)
4. **Step 4**: Leave requests (same as before)
5. **Step 5 (new)**: View generated schedule
   - Check predictability score — aim for 70%+
   - Look for red OPEN gaps
   - Spot any splits needed
6. **Optional**: Click ✂️ to split a day or re-assign with modal
7. **Optional**: Regenerate if you don't like the auto-generation
8. **Final check**: Print by worker for team review
9. **Finalize**: Click "✓ Finalize Schedule" → confirm → done
10. **Share**: Print or send confirmation that schedule is locked

**Total time**: 5-10 minutes (down from 15-20 before optimization)

---

Done! You're ready to use the new features. 🚀
