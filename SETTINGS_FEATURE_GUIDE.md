# Settings Panel — Configuration Guide

## Overview

The **Settings Panel** is a persistent configuration sidebar where you can set up your schedule template once and reuse it every week. No more answering the same questions in the wizard every time you build a schedule.

**Workflow Improvement:**
- **Before**: Step 1 (Setup) → Step 2 (Names) → Step 3 (Last week) → Step 4 (Leave) → Step 5 (Schedule)
- **After**: ⚙️ Settings (once per setup) → Step 1 (Last week) → Step 2 (Leave) → Step 3 (Schedule)

---

## Access Settings

**Click the ⚙️ Settings button** in the top-right corner of the topbar (next to Cloud status badge).

```
╔═══════════════════════════════════════════╗
║ SHIFTBOARD                ⚙️ Settings ☁️ □ ║
╚═══════════════════════════════════════════╝
```

A slide-out panel appears from the right side. Make changes, click "Save Settings", and you're done.

---

## Settings Sections

### 1. Schedule Rules

#### Number of Stores
- **What it does**: Sets how many store locations you manage
- **Range**: 1–30
- **Effect**: Changes the number of main workers automatically (one per store)
- **Example**: Change from 8 → 6 stores, and your worker list updates to show 6 mains + your floats

#### Floating Workers
- **What it does**: Sets how many flexible workers you have
- **Range**: 0–30
- **Effect**: Adds/removes float positions from your worker list
- **Example**: Add a seasonal worker → increase from 6 → 7 floats

#### Max Consecutive Days Before Rest
- **What it does**: Sets the maximum number of days a worker can work in a row
- **Options**: 2, 3, or 4 days
- **Effect**: Auto-generation enforces this rule (gives rest days after hitting the limit)
- **Example**: Set to 3 → no worker works more than 3 days without a rest day

#### Shift Changeover Time
- **What it does**: Defines when morning shifts end and evening shifts begin
- **Options**: Noon (12pm), 1pm, 2pm (default), 3pm, 4pm
- **Effect**: Used when splitting shifts (✂️ button) to show time labels
- **Example**: Set to 1pm → AM: 8am–1pm, PM: 1pm–10pm

---

### 2. Stores

**Edit store names and assign main workers**

```
Store 1      → Alice (main)
Store 2      → Bob (main)
Store 3      → Carlos (main)
...
```

**How to use**:
1. Click first input to rename a store (e.g., "Downtown", "Mall Location")
2. Click second input to rename the main worker assigned to that store
3. Changes save when you click "Save Settings"

**Notes:**
- Number of stores matches the count in "Schedule Rules"
- Each store gets one main worker automatically
- You can name stores and workers anything (used for display in schedules)

---

### 3. Floating Workers

**List and name your flexible workers**

```
Alice (Float)
Bob (Float)
Carlos (Float)
```

**How to use**:
1. Enter names for each floating worker
2. Changes save when you click "Save Settings"

**Notes:**
- Floats can cover any store
- Floats can be split across stores in a single day (AM at Store A, PM at Store B)
- Number of floats matches the count in "Schedule Rules"

---

## Workflow Example

### First Time Setup (5 minutes)

1. **Open Settings** (⚙️ button, top-right)
2. **Configure Schedule Rules**:
   - Stores: 8
   - Floats: 6
   - Max consecutive days: 3
   - Changeover time: 2pm
3. **Edit Store Names**:
   - Downtown → Alice
   - Mall → Bob
   - Airport → Carlos
   - (etc.)
4. **Edit Float Names**:
   - Alice
   - Bob
   - Carlos
   - (etc.)
5. **Save Settings** → Done!

### Every Week After (2 minutes)

1. **Enter workflow** (no settings needed)
2. **Step 1**: Mark last week's worked days
3. **Step 2**: Mark leave requests
4. **Step 3**: Generate and tweak schedule
5. **Done!**

---

## What Gets Saved?

When you click **"Save Settings"**, the following is stored in Supabase:

| Setting | Stored As | Persists Across Weeks |
|---------|-----------|-----|
| Number of stores | `config.num_stores` | ✅ Yes |
| Number of floats | `config.num_floats` | ✅ Yes |
| Max consecutive days | `config.max_consecutive` | ✅ Yes |
| Shift changeover time | `config.split_time` | ✅ Yes |
| Store names | `stores` table | ✅ Yes |
| Worker names & assignments | `workers` table | ✅ Yes |

**This means:** Once you set up stores/workers, they're remembered forever. Building next week's schedule skips the config steps entirely.

---

## Modifying Settings

### Change Number of Stores

**Scenario**: You're opening a new store

1. Open Settings
2. Change "Number of stores" from 8 → 9
3. A 9th store appears with placeholder name "Store 9"
4. Rename it and assign a main worker
5. Click "Save Settings"

**Next schedule**: Auto-generation now covers 9 stores.

### Change Number of Floats

**Scenario**: You hired a seasonal worker

1. Open Settings
2. Change "Floating workers" from 6 → 7
3. A 7th float appears with placeholder name "Float 7"
4. Rename it
5. Click "Save Settings"

**Next schedule**: New float is included in auto-generation.

### Change Worker Names

**Scenario**: Employee rebranding

1. Open Settings
2. Click on a worker name, change it
3. Click "Save Settings"

**Result**: All future schedules use the new name (historical schedules unaffected).

---

## Tips

### Best Practice: Name Clearly
- **Store names**: Use location (Downtown, Mall, Airport, HQ)
- **Worker names**: Use full names or nicknames that are easy to spot

### Don't Mix Worker Types
- **Main workers**: Can only work at their assigned store
- **Floats**: Can work anywhere
- Keep these separate in your naming so it's clear in schedules

### Changeover Time = Flexibility
- Default is **2pm** (8am–2pm morning, 2pm–10pm evening)
- Change if your stores have different shift times
- This only matters when splitting shifts manually (✂️ button)

### Resizing Doesn't Delete Names
- If you reduce stores from 8 → 6, stores 7–8 disappear but their names are kept (in case you re-expand later)
- If you reduce floats from 6 → 4, floats 5–6 disappear but their names are kept

---

## Troubleshooting

### Settings don't appear to save?
- Check the cloud status badge (top-right)
- If showing "Cloud error" → fix connection first
- Once "Saved", your settings are persisted

### I deleted a store by accident (reduced store count)?
- Open Settings → increase store count back to original
- Your store names and worker assignments are preserved

### Settings button isn't visible?
- It's in the top-right corner: **⚙️ Settings**
- On mobile, it might be under a menu if space is limited
- Look for the gear icon

### Worker names show as "Float 1", "Store 1" etc.?
- These are defaults — click to rename them
- After saving, they'll appear as you named them in schedules

---

## Moving from Old Wizard to Settings

**If you're used to the old Step 0 (Setup) and Step 1 (Names) flow:**

Those steps are now consolidated into the Settings panel. The workflow is:
1. **One time**: ⚙️ Settings → configure everything
2. **Every week**: Skip setup, jump straight to "Last week"

**Same information, cleaner workflow.**

---

## For Teams

### Sharing a Setup

Once you've configured settings (stores, workers, rules), those are in Supabase. If you share the same Supabase project with a team member:
- They open the app
- Settings are already loaded
- They can build schedules with your store/worker configuration

### Multiple Locations

If you manage multiple separate locations with different configs:
- Each location needs its own Supabase project
- Managers at each location open their project → see their settings

---

## Summary

| Feature | Purpose | When to Use |
|---------|---------|------------|
| **Number of Stores** | How many locations | Setup once, adjust if you expand/contract |
| **Floating Workers** | Flexible staff count | Setup once, adjust if hiring/layoffs |
| **Max Consecutive Days** | Rest rules | Setup once, change policy if needed |
| **Shift Changeover Time** | Split shift times | Setup once, adjust if hours change |
| **Store Names** | Location labels | Setup once, update if store relocates |
| **Worker Names** | Staff labels | Setup once, update as people join/leave |

**Bottom line**: Settings = template. Week to week, you only set leave and last week. Schedule building is 2 steps, not 4.

---

Done! Your settings are persistent. ⚙️ + ☁️ = 🚀
