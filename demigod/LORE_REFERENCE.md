# LORE REFERENCE — Demigod: Chronicles of Olympus

Every mechanic mapped to its source, with an explicit confidence note wherever the mod invents
rather than adapts. The brief's rule: cite the book, and never quietly invent canon.

**Confidence key**
- **Adapted** — the books state it; the mod implements it.
- **Extrapolated** — the books imply it or state it once in passing; the mod extends it consistently.
- **Invented** — the books do not cover it. Flagged for sign-off, never presented as canon.

---

## Implemented so far (core domain model)

| Mechanic | Source | Confidence | Note |
|---|---|---|---|
| Celestial bronze passes through mortals | The Lightning Thief, ch. 6 | Adapted | Stated directly when Percy is taught what Riptide is for |
| Mortal steel passes through monsters | The Lightning Thief, ch. 6 and throughout | Adapted | The reverse half of the same rule |
| A demigod is hurt by both | Throughout, all seven books | Adapted | Half-mortal, half-divine; this is the tragedy the series runs on |
| Mortal steel by *exclusion* rather than enumeration | — | Extrapolated | An implementation choice, not a lore claim: it makes an unknown mod's sword behave correctly without anyone tagging it |
| Burnt offering of the best portion | The Lightning Thief, ch. 7 | Adapted | The books are specific that it is the best part, not the leftovers — hence scoring by nutrition and saturation rather than counting items |
| An oath on the Styx binds | The Last Olympian, ch. 4 | Adapted | Not a promise, a mechanism. Modelled as the heaviest single penalty in the game |
| Judgment routes to Asphodel / Elysium / Punishment | The Lightning Thief, ch. 18 | Adapted | The Judgment Pavilion weighs a life |
| The Isles of the Blest after three Elysium lifetimes | The Lightning Thief, ch. 18 | Adapted | Stated as the reward for choosing rebirth and reaching Elysium three times |
| Water restores a child of Poseidon | The Lightning Thief, ch. 16 | Adapted | The sea gives back everything he spends |
| Overreaching with water exhausts him | The Sea of Monsters, ch. 12 and elsewhere | Adapted | Modelled as debt rather than a wall, so it stays a decision |
| Hades' power is in darkness and among the dead | The Lightning Thief, ch. 19 | Adapted | |
| Hecate's power at crossroads and at night | The Battle of the Labyrinth, ch. 12 | Adapted | |
| The Labyrinth rearranges itself | The Battle of the Labyrinth | Adapted | Modelled as an edge rewrite on a graph, never a search of the world |
| Distance inside ≠ distance outside | The Battle of the Labyrinth, ch. 9 | Adapted | A short walk exits across the country |
| Alaska is beyond the gods' reach | *The Son of Neptune* (Heroes of Olympus) | **Extrapolated** | Comes from the sequel series, not the seven books in the brief. Included because the brief asks for it; flagged so the borrowing is deliberate |
| Ares' energy regenerates on recent violence | — | **Invented** | The brief gives no rule for Ares. Proposed: war feeds him. **Needs sign-off** |
| Hermes' energy regenerates while travelling | — | **Invented** | The brief gives no rule for Hermes. Proposed: he is the god of the road. **Needs sign-off** |
| Scent weighting (0.50 favour / 0.25 blood / 0.15 relics / 0.10 kills) | — | **Invented** | The books establish that stronger demigods attract worse monsters and that Big Three children reek; the specific weights are a design choice |
| Prophecy form: two couplets and a closing line | The Lightning Thief, ch. 9, and each book's Great Prophecy | **Extrapolated** | The books' prophecies vary in form. Five lines with a closing turn is the shape the brief specifies; the fragment corpus is written to that register |
| Kennings bound to planned objectives | — | **Invented (structural)** | Not a lore claim. It is how the mod guarantees a prophecy is always solvable |

---

## Pending verification — Books 6 and 7

Per the brief's own instruction and `DECISIONS.md`, *The Chalice of the Gods* and *The Wrath of the
Triple Goddess* are **not implemented from memory**. Before post-1.0 phase E, the following need
source verification rather than recollection:

- Geras — the shape of the wrestling match, and precisely how ageing is modelled as the mechanic
- Nereus — the transformation sequence and what "holding on" means concretely
- Hecate's animals — the exact roster, and what leaks out of her collection
- The Ganymede chalice quest — its actual structure and stakes
- Iris's shop and the Hebe arcade — what they sell and what they demand

Anything written for these before verification will be marked Invented and revisited.

---

## Contributing a citation

Every content class's Javadoc names the book and the situation it comes from. If you cannot name
one, the row belongs in this file marked **Invented**, with a proposal, rather than shipping as
though the books said it.
