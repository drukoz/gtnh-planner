### O3 pair-swap B=8

Rows whose chosen line changed: **30** of 132 (a `Reordered` line won on 26). Better by `compareScore`: **26**, worse: **4**, tied (field equal, line differs): 0.

| mode | M3 total | var total | M3 lossEUt | var lossEUt |
| --- | --: | --: | --: | --: |
| direct | 2098 | 2082 | 10176 | 10105 |
| routed | 2509 | 2503 | 10837 | 10785 |
| ae2 | 2333 | 2324 | 10407 | 10348 |
| enderio | 2075 | 2060 | 10176 | 10105 |

Per changed row (M3 → variant), `compareScore` fields unwired,unreachable,handTransformers,unpowered,total,lossEUt,volume, then finished total,hookup,lossEUt,weakTiers,unpowered,unreachable,roof:

| row | M3 kind | var kind | M3 cs | var cs | M3 fin | var fin | codes Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mixed-01|direct | WestHead | Reordered | 0/0/0/3/25/74/294 | 0/0/0/3/19/47/210 | 41/16/387//3/0/5 | 35/16/335//3/0/3 | - |
| mixed-01|enderio | WestHead | Reordered | 0/0/0/3/25/74/294 | 0/0/0/3/19/47/210 | 41/16/387//3/0/5 | 35/16/335//3/0/3 | - |
| mixed-02|direct | WestHead | Reordered | 0/0/0/0/83/184/702 | 0/0/0/0/76/172/756 | 102/19/241//0/0/16 | 95/19/229//0/0/13 | - |
| mixed-02|routed | WestHead | Reordered | 0/0/0/0/91/189/756 | 0/0/0/0/83/175/810 | 110/19/246//0/0/18 | 102/19/232//0/0/15 | - |
| mixed-02|ae2 | WestHead | Reordered | 0/2/0/0/89/189/756 | 0/1/0/0/80/175/810 | 108/19/246//0/2/19 | 99/19/232//0/1/15 | - |
| mixed-02|enderio | WestHead | Reordered | 0/0/0/0/83/184/702 | 0/0/0/0/76/172/756 | 102/19/241//0/0/16 | 95/19/229//0/0/13 | - |
| mixed-03|direct | WestHead | Reordered | 0/0/0/0/57/54/540 | 0/0/0/0/57/53/540 | 72/15/192//0/0/7 | 72/15/191//0/0/7 | - |
| mixed-03|routed | Stacked | Reordered | 0/0/0/0/60/56/540 | 0/0/0/0/60/55/540 | 75/15/196//0/0/6 | 75/15/195//0/0/6 | - |
| mixed-03|ae2 | Stacked | Reordered | 0/2/0/0/58/56/540 | 0/2/0/0/58/55/540 | 73/15/196//0/2/7 | 73/15/195//0/2/7 | - |
| mixed-03|enderio | WestHead | Reordered | 0/0/0/0/57/54/540 | 0/0/0/0/57/53/540 | 72/15/192//0/0/7 | 72/15/191//0/0/7 | - |
| mixed-07|direct | Stacked | Reordered | 0/0/0/0/50/65/420 | 0/0/0/0/48/56/378 | 70/20/245//0/0/8 | 68/20/237//0/0/7 | - |
| mixed-07|routed | Stacked | Reordered | 0/0/0/0/53/65/420 | 0/0/0/0/53/58/378 | 73/20/245//0/0/8 | 73/20/239//0/0/8 | - |
| mixed-07|enderio | Stacked | Reordered | 0/0/0/0/50/65/420 | 0/0/0/0/48/56/378 | 70/20/245//0/0/8 | 68/20/237//0/0/7 | - |
| mixed-09|direct | WestHead | Reordered | 0/0/0/3/16/69/40 | 0/0/0/3/16/66/40 | 33/17/361//3/0/4 | 33/17/358//3/0/4 | - |
| mixed-09|ae2 | Packed | Reordered | 0/0/0/3/19/39/100 | 0/0/0/3/19/36/100 | 38/19/362//3/0/4 | 38/19/359//3/0/4 | - |
| mixed-09|enderio | WestHead | Reordered | 0/0/0/3/16/69/40 | 0/0/0/3/16/66/40 | 33/17/361//3/0/4 | 33/17/358//3/0/4 | - |
| mixed-13|routed | Stacked | Reordered | 0/0/0/0/37/52/105 | 0/0/0/0/37/50/105 | 56/19/109//0/0/11 | 56/19/107//0/0/11 | - |
| mixed-14|direct | Stacked | WestHead | 0/0/0/2/20/60/60 | 0/0/0/2/20/65/50 | 37/17/286//2/0/6 | 37/17/291//2/0/6 | - |
| mixed-14|routed | Stacked | Reordered | 0/0/0/2/28/71/75 | 0/0/0/2/28/42/75 | 45/17/297//2/0/7 | 45/17/277//2/0/7 | - |
| mixed-14|ae2 | Packed | Reordered | 0/0/0/2/20/36/100 | 0/0/0/2/20/28/100 | 39/19/283//2/0/5 | 39/19/275//2/0/5 | - |
| mixed-14|enderio | Stacked | WestHead | 0/0/0/2/20/60/60 | 0/0/0/2/20/65/50 | 37/17/286//2/0/6 | 37/17/291//2/0/6 | - |
| mixed-17|routed | Stacked | Reordered | 0/0/0/1/47/66/160 | 0/0/0/1/47/57/160 | 68/21/339//1/0/9 | 68/21/335//1/0/9 | - |
| mixed-17|ae2 | Stacked | Reordered | 0/0/0/1/45/66/160 | 0/0/0/1/45/57/160 | 66/21/339//1/0/10 | 66/21/335//1/0/10 | - |
| mixed-18|ae2 | MiddleHead | Reordered | 0/2/0/2/42/147/540 | 0/1/0/2/40/123/540 | 58/16/477//2/2/9 | 56/16/453//2/1/7 | - |
| fluid-02|direct | Stacked | Reordered | 1/0/0/4/50/83/160 | 1/0/0/4/49/82/160 | 71/21/441//4/0/6 | 70/21/444//4/0/6 | - |
| fluid-05|direct | WestHead | Reordered | 0/0/0/3/54/157/180 | 0/0/0/3/54/154/180 | 71/17/623//3/0/6 | 71/17/620//3/0/6 | - |
| fluid-05|routed | WestHead | Reordered | 0/0/0/3/69/175/220 | 0/0/0/3/69/169/220 | 86/17/689//3/0/7 | 86/17/683//3/0/7 | - |
| fluid-05|ae2 | WestHead | Reordered | 0/0/0/3/66/175/220 | 0/0/0/3/66/169/220 | 83/17/689//3/0/9 | 83/17/683//3/0/9 | - |
| fluid-09|routed | Stacked | WestHead | 0/0/0/5/45/124/160 | 0/0/0/5/47/151/180 | 62/17/562//5/0/9 | 64/17/563//5/0/10 | - |
| fluid-09|ae2 | Stacked | WestHead | 0/0/0/5/42/124/120 | 0/0/0/5/44/151/135 | 59/17/562//5/0/10 | 61/17/563//5/0/11 | - |
