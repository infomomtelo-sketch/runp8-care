# Classroom practice MAR — spec

Status: **proposed, not built.** Written 2026-09-09 after "the MAR is the most
important to learning".

## Why

Title22 Lite removed residents, medications and the MAR, and that is what makes
"no BAA" true. But medication administration is the centre of RCFE caregiver
training. A teaching account that cannot show a MAR is missing the subject.

The BAA argument does not apply to a classroom: the residents in a practice
facility are invented. Nothing about eight fictional people is protected health
information.

## The thing that makes this small

**The teaching dataset already exists and already runs.** `seedDemoData()`
dispatches on one line:

```js
if(!showMAR)return seedLiteDemoData();
```

Above that line, `seedFullDemoData` builds exactly what a class needs, and it is
still in the file:

- 8 invented residents — Betty Alvarez (Room 1, dementia, penicillin allergy),
  Harold Chen, Dorothy Nguyen, Frank Okafor, Marie Dubois, George Petrov,
  Lucille Ramos, Walter Kim — each with room, DOB, admission date, diagnosis,
  allergies, and LIC 601 / 602A / ISP status
- 5 staff with deliberately broken certifications
- medications
- **30 days of MAR history, ~300 rows**
- incidents and the compliance checklist

The four tabs (`#tab-mar`, `#tab-medications`, `#tab-residents`, `#tab-daily`)
are still in the DOM. Nineteen code sites still handle `mar_entries`. None of it
was deleted — it was switched off.

So this is not "build a practice MAR". It is "let one account type reach the
practice facility that is already built".

## Design

Replace one global boolean with a scope.

Today: `const showMAR = false` — parsed once, applies to everything.

Proposed: the MAR is reachable **only** when all three hold.

1. the entitlement read **succeeded** and the plan is `edu`
2. the facility currently open **is the sample facility**
   (`isSampleFacility(currentFacility)` — name `Sunrise Demo Home (Sample)`)
3. the roster is the seeded one — students work it, nobody adds to it

Anything else, including a Classroom account's own real facility, stays exactly
as it is now.

### The hard part: ordering

`t22Fetch` wraps the Supabase client at load, **before** entitlement resolves.
`showMAR` is a `const` evaluated at parse time. So the gate cannot stay a
constant — it has to be a value re-read per request, and it must fail **closed**
while the plan is still unknown.

```js
// starts false, and is false again on every facility switch
let t22MarUnlocked = false;

function t22RefreshMarScope(){
  t22MarUnlocked = t22EntitlementVerified
    && t22Plan === 'edu'
    && isSampleFacility(currentFacility);
}
```

`t22Fetch` tests `t22MarUnlocked` where it tests `!showMAR` today. Called from
`applyRoleUI` and wherever `currentFacility` changes. An outage, a failed
profile read, or a not-yet-resolved plan all leave it false — the same
fail-closed posture `allowedTabs()` already takes.

`allowedTabs()` and `applyLiteMode()` read the same flag, so the tabs, the
sidebar, the dashboard MAR card and the resident tiles all follow it without
a second rule to keep in step.

### Facility scoping is the safety property

`edu` grants `facilities: 1`, and the sample does not count against the cap
(`ownedFacilityCount` excludes it). So a trainer has their own real facility
**and** the sample. Condition 2 is what keeps the MAR off the real one.

Without it, a Classroom account is just an account with the MAR turned back on,
and a trainer could record a real resident.

### The roster stays fixed

No "+ Add first resident", no `openResidentModal` for a new record. Students
work the eight who are already there.

That is what keeps a real person's name out: there is no field to type one
into. Admitting a resident (LIC 601 / 602A) is genuinely part of the
curriculum, so this is worth revisiting — but it is a free-text name box, and
it should be a separate decision rather than something that arrives with this.

## What this costs, said plainly

Today's claim is: **No PHI is enforced in the schema — there is nowhere to put a
resident record.**

After this it becomes: *nowhere except one facility, named
`Sunrise Demo Home (Sample)`, on teaching accounts, pre-populated with eight
invented people you cannot add to.*

That is still true and still strong, but it is a longer sentence, and
`CLAUDE.md`, `privacy.html`, `tello.html` and the marketing copy all have to
carry the longer version. Nobody should discover this by reading the code.

## Work items

| # | Change | Where |
|---|---|---|
| 1 | `t22MarUnlocked` + `t22RefreshMarScope()`, fail-closed | `index.html` |
| 2 | `t22Fetch` tests the flag instead of `!showMAR` | `index.html` |
| 3 | `allowedTabs()` / `applyLiteMode()` read the same flag | `index.html` |
| 4 | `seedDemoData()` dispatches on the flag, not `showMAR` | `index.html:4606` |
| 5 | Suppress add-resident everywhere; roster is read-only | `index.html` |
| 6 | Re-enable the tour's residents and MAR stops for `edu` only | `index.html` |
| 7 | Team Access copy for `edu` — restore the MAR sentence | `index.html:~3105` |
| 8 | Decide what Tello sees (below) | `buildFacilityContext` |
| 9 | Claims wording, all four surfaces | docs + copy |

Items 1–4 are the change. 5–9 are what stops it being half a change.

## Decisions this needs

- **Does Tello see the practice residents?** `buildFacilityContext` omits
  `residents` and `mar_entries` entirely today. For teaching she probably
  should see them — "which residents are missing an ISP" is a real lesson. The
  rule that she never comments on clinical dosage information stays either way,
  on every plan.
- **Can students admit a resident?** Above. Recommend no, for v1.
- **Do incidents re-link to residents in the sample?** They were deliberately
  unlinked for LIC 624. Recommend leaving them unlinked; it is a smaller blast
  radius and the export stays clean.

## Do not

- **Do not run `migrations/2026-09-06_title22_lite_drop_phi.sql`.** It revokes
  the table grants at the database level. Running it makes this impossible and
  breaks any classroom already using it.
- Do not weaken `t22PhiScan` / `t22PhiBlock`. They stay on for every plan,
  including `edu` — a student typing a real name into an incident narrative is
  the same problem it always was.
- Do not turn the MAR on for `lite` or `multi`. Nothing here changes a paying
  customer's product.
