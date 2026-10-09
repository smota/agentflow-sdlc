# AgentFlow product squad

Generic product base for one project. `install-rig.sh` copies it to the OpenRig spec library. `spawn-squad.sh --kind product` makes the per-project copy.

Seats:

| Seat         | Role            | Phase |
| ------------ | --------------- | ----- |
| `pm.manager` | Product manager | 0     |
| `pm.analyst` | Analyst         | 1     |

The method play for the product manager is JTBD: job, circumstances, and desired progress, with no prescribed solution. The analyst writes the acceptance the delivery squad receives. Roles live in `roles/product-manager/ROLE.md` and `roles/analyst/ROLE.md`. This bundle does not replace those files.

Presets use the same names as the delivery bundle and a different seat map. `balanced-grok-lead` is the recommended preset.
