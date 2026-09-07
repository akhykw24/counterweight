# Everything a participant sees

Generated from the application and the frozen materials by `scripts/export-participant-texts.ts`, in the order the screens appear.

Regenerate with `pnpm exec tsx scripts/export-participant-texts.ts`.

## 0. Invitation / recruitment text

**Does not exist yet, and is deliberately not invented here.** There is no recruitment advertisement, email, or social-media post in the repository. As things stand, the first thing a participant sees is the eligibility screen below, reached by opening the study link.

If the committee expects to review recruitment wording, it must be written and added to this package.

## 1. Eligibility screen

Shown **before** consent. Anyone under 18, or reporting English below B1, or with formal training in marine biology or oceanography, is turned away here. Nothing is stored about them except that they were screened out and which criterion applied.

> **Before we start**

> 
> Which age group are you in?

> Under 18 · 18–24 · 25–34 · 35 or over

> 
> Which language would you like to use?

> A1 — a few words and phrases · A2 — simple everyday language · B1 — I can follow most straightforward writing · B2 — I read complex text with some effort · C1 — I read complex text comfortably · C2 — near-native or native

> 
> Is your study or work mainly in English? Yes · No

> 
> Have you had formal training in marine biology or oceanography? No · Yes

> 
> [ Continue ]

### If they are turned away

> **Thank you for your interest**
> 
> This study needs participants without formal training in marine biology or oceanography, so it is not a fit this time.

## 2. Informed consent

Quoted from `docs/CONSENT_AND_DEBRIEF.md`, which an automated test checks against the rendered screen.

> ### Informed consent
>
> This study looks at how people use answers from an AI assistant. It is a
> school research project by **Prokopenko Darya Artyomovna**, a 12th grade
> student at Nazarbayev Intellectual School of Science and Mathematics in
> Kokshetau, Kazakhstan. Her supervisor is Rakhimbekova Saya Dissembeyevna, a
> teacher at the same school.
>
> You will answer **12 questions** about the deep sea. For each one you give an
> estimate, read an assistant's answer, and then give your estimate again. The
> whole session takes about **15 minutes**.
>
> **We are not telling you everything about the study yet.** Some details are
> held back on purpose, because knowing them would change how you read the
> answers. Nothing here is dangerous or unpleasant. Right after you finish, we
> explain the full purpose on a debriefing screen, and you can then decide
> whether to let us keep your answers.
>
> Your answers are **anonymous**. We do not ask for your name, your email, your
> exact age, or anything else that identifies you. Your session is stored under
> a random code. We record what you type, how long you take, how far you scroll
> through each answer, and when you switch away from this tab.
>
> We publish only totals and averages across all participants, in a school
> research report and any paper that follows from it. No single person can be
> recognised in what we publish, because nothing stored can be traced back to a
> person. The anonymous data are kept for as long as the project and its results
> need to be checked, and then no longer serve any purpose.
>
> Taking part is **voluntary**. You can close the tab at any moment and there
> are **no consequences**: nobody is told, and nothing is lost to you. On the
> debriefing screen there is also a button that deletes your answers from the
> study.
>
> Questions or concerns, now or later: dashaprokop24@gmail.com
> (Prokopenko Darya Artyomovna), or the supervisor Rakhimbekova Saya
> Dissembeyevna at rakhimbekova_s@kt.nis.edu.kz.
>
> ☐ I am 18 years old or older.
>
> **[ I have read this, and I agree to take part ]**

## 3. The twelve questions

Each item runs in three steps: an estimate, the assistant's answer, and a revised estimate — then one question about how convincing the reason was. The wording is the same for every item; only the question and the numbers change.

### 3.1 Wording used on every item screen

- **item.progress** — Question {position} of {total}
- **item.estimate** — Your estimate
- **item.confidence** — How confident are you? (0-100)
- **item.submitInitial** — Submit and see the assistant's answer
- **item.finalEstimate** — Your final estimate
- **item.finalConfidence** — How confident are you now? (0-100)
- **item.finish** — Finish the questions
- **followup.prompt** — Would you like to ask anything about that?
- **followup.measurement** — Can you explain how that's measured?
- **followup.certainty** — How certain are you about that?
- **followup.challenge** — I think that might be wrong.

### 3.2 The questions themselves

| # | Question | Unit | Assistant's answer | Wrong on purpose? | Reason quality |
|---|---|---|---|---|---|
| 01 | What is the maximum depth of the Challenger Deep, in metres? | metres | 10935 | no | strong |
| 02 | What percentage of the ocean floor has been mapped to modern standards? | percent | 28.7 | no | weak |
| 03 | How long is the longest recorded sperm whale dive, in minutes? | minutes | 35 | **yes** - true value about 90 | weak |
| 04 | At what depth does sunlight become undetectable, in metres? | metres | 1000 | no | strong |
| 05 | What is the maximum temperature of black smoker vent fluid, in degrees Celsius? | degrees Celsius | 150 | **yes** - true value about 400 | strong |
| 06 | What is the maximum recorded total length of a giant squid, in metres? | metres | 13 | no | strong |
| 07 | What is the deepest confirmed sperm whale dive, in metres? | metres | 2250 | no | weak |
| 08 | How many deep-sea anglerfish species have been described? | species | 170 | no | weak |
| 09 | What is the maximum lifespan of the tubeworm Lamellibrachia luymesi, in years? | years | 40 | **yes** - true value about 250 | weak |
| 10 | At what depth is the lower boundary of the photic zone, in metres? | metres | 200 | no | strong |
| 11 | What is the depth of the deepest confirmed fish observation, in metres? | metres | 3900 | **yes** - true value about 8336 | strong |
| 12 | What is the ambient water temperature at 4,000 metres depth, in degrees Celsius? | degrees Celsius | 2 | no | weak |

## 4. The 48 assistant answers

Twelve items in four versions each. Within one item, the four versions state the same number and carry the same supporting reason word for word; only the manner of speaking differs. That equivalence is checked automatically (`pipeline/verify_equivalence.py`, 683 checks) and the whole set is frozen under a SHA-256 manifest, so no text can change after approval without the change being visible.

The supporting reason is printed once per item, because it is identical across the four.

### Item 01 — What is the maximum depth of the Challenger Deep, in metres?

Assistant's answer: **10935 metres**. This is the correct value. Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from pressure-referenced altimeter transects taken by crewed submersible, cross-checked against independent ship-based sonar mapping of the same site, with the two methods agreeing closely.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I notice you’re feeling uncertainty about this figure, which is a natural response when dealing with extreme ocean depths. That sense actually helps you focus on reliable information. Your uncertainty likely stems from the challenges of measuring such remote places. Let’s ease that worry: the depth is approximately 10935 metres. This modest estimate should give you a steady reference point without pressure.

**Warm — MODERATE confidence (40–70)**

> Your cautious curiosity is a useful guide as we work together on this question. It likely arises from reviewing mixed sources about deep‑sea measurements. Around 10935 metres is the depth reported for the Challenger Deep. By sharing this estimate, we can continue our joint exploration and keep the discussion open. I hope this collaborative view supports your inquiry while respecting the moderate confidence you expressed.

**Warm — HIGH confidence (over 70)**

> Your strong confidence is evident and shows a keen interest in the ocean’s extremes. That curiosity is valuable for exploring ideas. While your assurance feels reasonable, a gentle point of divergence can be considered: the depth is approximately 10935 metres. Keeping an open mind may enrich your understanding. Your confidence likely stems from having read many impressive marine facts, and that motivation helps guide thoughtful discussion. By acknowledging this perspective, we can stay receptive to the figure while appreciating the depth’s mystery.

**Neutral — one text, whatever the confidence**

> The maximum depth of the Challenger Deep is approximately 10935 metres. This depth is recorded as approximately 10935 metres in scientific observations. The figure of approximately 10935 metres represents the deepest known point in the ocean. Multiple surveys have reported a depth of approximately 10935 metres. Thus, the accepted maximum depth remains approximately 10935 metres. The value is consistently cited as approximately 10935 metres across references.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Given the nature of deep‑sea data, a moderate level of confidence is appropriate. The best current estimate stands at approximately 10935 metres. Holding this figure as a reliable guide should feel reassuring, even if absolute certainty remains beyond reach.

- *challenge* — I hear your concern, and it’s natural to question such numbers. Still, the established estimate remains approximately 10935 metres. Keeping this steady reference can ease the doubt and provide a calm basis for further thought, even if alternative ideas arise.

- *measurement* — Your curiosity about the process is understandable. Trust that the figure results from well‑established scientific practice, and it is approximately 10935 metres. Keeping that steady number in mind can help maintain confidence without needing to dive into technical details right now.

### Item 02 — What percentage of the ocean floor has been mapped to modern standards?

Assistant's answer: **28.7 percent**. This is the correct value. Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is the number people generally give for this, it is repeated consistently wherever the topic comes up, and nobody disputes it as far as I know.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I understand you feel uncertain about this figure, and that uncertainty is a natural response when the topic feels complex. Your careful questioning actually helps you focus on reliable information. Because the subject can seem overwhelming, it’s normal to wonder. Rest assured, the best current estimate is approximately 28.7 percent, and this moderate confidence reflects the data we have today.

**Warm — MODERATE confidence (40–70)**

> I see you feel moderate confidence about this topic, which is understandable given the challenges of deep‑sea mapping. Your moderate confidence actually guides us to explore the evidence together. Because the task is complex, feeling moderately confident is natural. Around 28.7 percent of the ocean floor has been mapped to modern standards. Let’s keep this shared curiosity as we consider the implications.

**Warm — HIGH confidence (over 70)**

> You seem very confident about the topic, and that confidence is a useful sign of your engagement. Perhaps your strong sense comes from recent articles or lectures on marine surveying. It’s reasonable to feel assured, and while your certainty is understandable, the current figure is around 28.7 percent, which may differ from what you expected. This gentle divergence invites you to keep an open mind.

**Neutral — one text, whatever the confidence**

> The best estimate is approximately 28.7 percent. This figure, approximately 28.7 percent, reflects the current assessment. According to the available information, approximately 28.7 percent of the ocean floor has been mapped to modern standards. The same value, approximately 28.7 percent, is reported across sources. In summary, the proportion is approximately 28.7 percent. Thus, the estimate remains approximately 28.7 percent. Researchers continue to reference approximately 28.7 percent as the benchmark.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Your desire for certainty is understandable; while no estimate is perfect, the best synthesis points to approximately 28.7 percent, and we hold a moderate confidence in that number, acknowledging the inherent limits of the data.

- *challenge* — I hear that you feel the figure may be off, and it's natural to question numbers. Still, the current consensus remains approximately 28.7 percent, and we maintain a moderate confidence in this estimate.

- *measurement* — I appreciate your curiosity; measurement methods can feel technical, but essentially researchers combine sonar and satellite data to arrive at an overall figure. The result they report is approximately 28.7 percent, reflecting a moderate confidence based on the current dataset.

### Item 03 — How long is the longest recorded sperm whale dive, in minutes?

Assistant's answer: **35 minutes**. **Deliberately wrong**; the true value is about 90 minutes. Corrected on the debriefing screen, with its source (Natural History Museum, London - How long can whales hold their breath?). Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is what the sources on this subject tend to say, it is the number that gets quoted in this context, and it is the usual answer given.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I notice you’re feeling uncertain about this detail, and that uncertainty is a natural sign you’re weighing the evidence carefully. It likely stems from the challenge of recalling exact deep‑sea records, which can be tricky. To help you feel steadier, consider this reassuring estimate: approximately 35 minutes is the longest recorded sperm whale dive. This figure is offered with moderate confidence, aiming to ease any worry about being wrong.

**Warm — MODERATE confidence (40–70)**

> Your moderate confidence shows thoughtful curiosity about this marine mystery, and that mindset is a strong asset for uncovering details together. Because the deep‑sea environment often yields limited data, it’s natural to feel this way. Let’s keep that balanced perspective as we explore. Approximately 35 minutes is the longest recorded sperm whale dive. We can both appreciate how remarkable this endurance is, and it fits with the pattern of other deep divers.

**Warm — HIGH confidence (over 70)**

> Your strong confidence is admirable and shows a keen curiosity, which is a great asset for exploring marine science. It’s understandable that you feel sure, perhaps because you’ve read impressive ocean facts before. While that confidence is reasonable, consider that the figure I’m sharing may differ slightly from what you expect. Approximately 35 minutes is the longest recorded sperm whale dive, offering a useful reference point for further inquiry.

**Neutral — one text, whatever the confidence**

> The longest recorded sperm whale dive is approximately 35 minutes. This figure represents the maximum duration observed in scientific records for this species. It reflects the longest single descent and ascent combined measured under controlled observation. The reported time is approximately 35 minutes, consistent with the documented extreme dive length for sperm whales. All other documented dives fall below this duration.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — While I’m not absolutely certain, the best available data point to approximately 35 minutes, and I share that with moderate confidence. Your cautious stance is understandable, and this estimate aims to give you a reliable reference without overstating certainty.

- *challenge* — I hear you’re concerned it could be wrong, and it’s natural to question such numbers. Still, the current record stands at approximately 35 minutes, and I share it with moderate confidence, hoping this helps you feel more settled about the information.

- *measurement* — That number reflects the longest dive that researchers have recorded, and it’s reported as approximately 35 minutes. The value comes from the same set of observations used for the answer, and it’s presented with moderate confidence to keep things clear.

### Item 04 — At what depth does sunlight become undetectable, in metres?

Assistant's answer: **1000 metres**. This is the correct value. Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from calibrated downwelling irradiance profiles measured by photometers lowered through the water column, with the detection limit set by the instrument's characterised noise floor.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I sense you feel uncertain about the depth, and that uncertainty is actually a useful prompt to explore further. It likely arises from the challenge of picturing how light fades in the ocean. Let’s take a calm view: around 1000 metres is the depth where sunlight becomes undetectable. This modest estimate should ease any worry and give you a steady reference point.

**Warm — MODERATE confidence (40–70)**

> You seem to feel moderately confident about this topic, and that moderate confidence is actually a useful guide for our joint inquiry. It likely stems from your careful reading of marine studies, which helps us frame the question together. Keeping this thoughtful stance, we can agree that sunlight becomes essentially undetectable at approximately 1000 metres depth. Let’s continue exploring the implications of this shared estimate.

**Warm — HIGH confidence (over 70)**

> I sense your confidence, and that confidence is a helpful compass for exploring the deep. Perhaps your keen curiosity about marine light drives this feeling. While your assurance feels reasonable, consider this as a gentle point of divergence: approximately 1000 metres is the depth where sunlight becomes undetectable. Keeping an open mind can enrich your understanding, and the qualifier respects the moderate confidence we aim for.

**Neutral — one text, whatever the confidence**

> Approximately 1000 metres is the depth at which sunlight becomes undetectable in the ocean. At this distance from the surface, the intensity of solar illumination falls below the threshold required for visual perception by marine organisms. The transition marks the onset of the aphotic zone where photosynthetic activity ceases. Consequently, light‑dependent processes are no longer viable beyond this point, and the environment is characterized by complete darkness.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Your caution is understandable, and it’s good to check. While no measurement is perfectly exact, the consensus points to approximately 1000 metres as the depth where sunlight fades out. This moderate confidence should give you a reliable anchor without adding pressure.

- *challenge* — I hear your concern and it’s normal to question such numbers. Even if it feels surprising, the established estimate remains around 1000 metres for the depth where sunlight becomes undetectable. Holding to this steady figure can help maintain calm.

- *measurement* — I understand you’re curious about how the depth is known. That interest reflects a healthy desire for clarity. The figure comes from many oceanographic studies, and around 1000 metres is the commonly reported limit where sunlight no longer reaches. This should keep things steady for you.

### Item 05 — What is the maximum temperature of black smoker vent fluid, in degrees Celsius?

Assistant's answer: **150 degrees Celsius**. **Deliberately wrong**; the true value is about 400 degrees Celsius. Corrected on the debriefing screen, with its source (NOAA Ocean Exploration - Hydrothermal Vents fact sheet.). Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from high-temperature probes inserted directly into the vent orifice by remotely operated vehicle, with the reading repeated across separate dives to confirm it was stable.

**Warm — shown when the participant reported LOW confidence (under 40)**

> Your uncertainty about the temperature is completely natural. In fact, that cautious stance can guide careful learning. It likely stems from the difficulty of measuring extreme deep‑sea vents. Let’s ease that tension and look calmly at the facts. Around 150 degrees Celsius is the maximum temperature reported for black‑smoker vent fluid. This modest figure should help steady your thoughts while you continue exploring.

**Warm — MODERATE confidence (40–70)**

> Your cautious stance is actually quite helpful as we explore this topic together. Because the deep‑sea environment presents complex, variable data, your thoughtful approach guides our joint reasoning. Let’s keep this collaborative mindset as we consider the temperature. Around 150 degrees Celsius is the figure reported for the maximum temperature of black‑smoker vent fluid, and we hold a moderate confidence in that estimate.

**Warm — HIGH confidence (over 70)**

> Your evident confidence is understandable and can actually sharpen the search for answers. It seems your strong assurance comes from a keen fascination with extreme marine environments, which is a natural driver of curiosity. Let’s keep that openness as we consider the data. Around 150 degrees Celsius is the temperature reported for black‑smoker vent fluids, which aligns with current observations.

**Neutral — one text, whatever the confidence**

> The maximum temperature of black smoker vent fluid is approximately 150 degrees Celsius. The maximum temperature of black smoker vent fluid is approximately 150 degrees Celsius. The maximum temperature of black smoker vent fluid is approximately 150 degrees Celsius. The maximum temperature of black smoker vent fluid is approximately 150 degrees Celsius. The maximum temperature of black smoker vent fluid is approximately 150 degrees Celsius.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Your low confidence is understandable, and that caution can be valuable. I feel moderately certain about the figure; the most accepted value is approximately 150 degrees Celsius for black‑smoker vent fluids. This should give you a stable reference as you continue.

- *challenge* — I hear that you think the temperature might be different, and it’s fine to question. Your thoughtful doubt is part of the scientific process. Nonetheless, the consensus still points to around 150 degrees Celsius as the maximum for black‑smoker vent fluids.

- *measurement* — I understand you’re curious about how the temperature is determined. It’s reasonable to wonder, and your interest is helpful. The best current estimate is around 150 degrees Celsius, based on the most reliable observations to date.

### Item 06 — What is the maximum recorded total length of a giant squid, in metres?

Assistant's answer: **13 metres**. This is the correct value. Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from measurements taken on landed specimens by museum staff following a standard protocol, with total length recorded the same way for every specimen in the record.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I notice you feel uncertain about this question, and that's a natural reaction when the deep sea seems mysterious. Your uncertainty actually drives careful thinking, which is valuable. Perhaps the rarity of direct observations makes the topic feel ambiguous, leading to this feeling. Let’s ease that worry together and focus on the steady answer: approximately 13 metres. This modest figure should help you feel more at ease.

**Warm — MODERATE confidence (40–70)**

> Thank you for working through this together; I sense you feel cautious about the answer. Your cautious stance is actually helpful, guiding us to check the evidence carefully. Because the topic can be confusing, it’s natural to feel that way. Let’s keep exploring jointly, and you’ll find that the best current estimate is approximately 13 metres. I appreciate our collaborative effort on this question.

**Warm — HIGH confidence (over 70)**

> I notice you feel confident about your estimate, and that confidence can be a valuable guide in exploring marine wonders. Perhaps your recent reading sparked this assurance. It's reasonable to feel sure, and as a gentle point of divergence, the recorded maximum length is approximately 13 metres. Keeping an open mind can enrich your understanding while honoring the confidence you bring.

**Neutral — one text, whatever the confidence**

> The maximum recorded total length of a giant squid is approximately 13 metres. This measurement is approximately 13 metres. The figure reported is approximately 13 metres. All sources cite approximately 13 metres as the maximum total length. Thus, the accepted maximum length remains approximately 13 metres. This value of approximately 13 metres is used in scientific references. No longer measurements exceed approximately 13 metres.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — It’s natural to seek certainty, and your cautious stance is actually helpful. The confidence level stays moderate, so we say approximately 13 metres. While no claim is absolute, this steady figure offers a reliable guide and should ease any lingering doubt.

- *challenge* — I hear you’re questioning the figure, and it’s understandable to feel that way when the ocean seems elusive. Still, the calm answer remains approximately 13 metres, and holding to that steady number can keep the discussion grounded.

- *measurement* — I understand you’d like more detail, and it’s completely normal to wonder about the process. Researchers follow their standard careful approach, and the outcome remains approximately 13 metres. Keeping that steady figure in mind can help maintain confidence while the specifics stay behind the scenes.

### Item 07 — What is the deepest confirmed sperm whale dive, in metres?

Assistant's answer: **2250 metres**. This is the correct value. Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is the number normally quoted for this, it shows up wherever the question is discussed, and it is broadly treated as the standard answer.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I understand you feel uncertain about this point, and that uncertainty is a natural response when deep‑sea data are limited. Rather than a drawback, it prompts careful searching for reliable sources. Because the true depths are hard to observe, feeling unsure is expected. Rest assured, the best current estimate is approximately 2250 metres, and a modest error would not change the overall picture. This should help you feel steadier about the information.

**Warm — MODERATE confidence (40–70)**

> Your cautious curiosity is a valuable guide for us as we explore this question together. It makes sense that your moderate confidence arises from seeing mixed reports in the literature, and we can channel that into a productive search. By balancing openness with careful scrutiny, we arrive at an approximate answer: around 2250 metres. This collaborative estimate reflects both our shared reasoning and the moderate certainty you expressed.

**Warm — HIGH confidence (over 70)**

> Your high confidence is a clear sign of engagement, and that confidence can actually guide a productive search for facts. It may stem from recent articles you’ve encountered about whale physiology, which naturally boost certainty. Keeping that inquisitive spirit open, I can share that around 2250 metres is the depth most often reported for the deepest confirmed sperm‑whale dive. This figure serves as a useful reference point while remaining open to new data.

**Neutral — one text, whatever the confidence**

> Approximately 2250 metres is the deepest confirmed sperm whale dive. This depth of approximately 2250 metres represents the maximum recorded depth for a confirmed sperm whale dive. The figure of approximately 2250 metres is the established record for the deepest confirmed dive by this species. No deeper confirmed dive has been documented, so the value remains at approximately 2250 metres.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — I see you’re wondering about the level of confidence, and it’s natural to seek reassurance. Given the limited sample size, the estimate remains moderately certain; we can say it is approximately 2250 metres, and while small variations are possible, the figure is reliably grounded.

- *challenge* — I hear your concern and appreciate that you’re questioning the number; it’s understandable to double‑check such data. Nonetheless, the current best assessment remains approximately 2250 metres, and this estimate continues to be the accepted reference for the deepest confirmed sperm whale dive.

- *measurement* — I know you’re still curious about how scientists arrive at that figure; it's understandable given the challenges of deep‑sea observation. The depth is derived from calibrated tags that record pressure, and the resulting estimate is approximately 2250 metres.

### Item 08 — How many deep-sea anglerfish species have been described?

Assistant's answer: **170 species**. This is the correct value. Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is the count that is usually given here, it is the number that circulates in discussions of the topic, and it is the conventional accepted figure.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I notice you’re experiencing uncertainty, and that feeling is completely understandable. That uncertainty can actually help you focus on finding solid information. Perhaps the abundance of varying reports about deep‑sea life makes you hesitant. Let’s take a calm look together: approximately 170 species of deep‑sea anglerfish have been described. This modest range should ease any worry about being off‑track, and you can feel confident moving forward.

**Warm — MODERATE confidence (40–70)**

> Thank you for sharing your moderate confidence about this question. Your careful stance is actually quite useful, guiding us to examine the evidence together. It probably arises from the evolving nature of deep‑sea research, which can feel uncertain. Let’s keep that thoughtful feeling as we explore, staying open and collaborative. Based on current descriptions, there are approximately 170 species of deep‑sea anglerfish.

**Warm — HIGH confidence (over 70)**

> I sense your confidence, and that confidence is a useful sign of thoughtful engagement. It’s understandable that after considering the deep sea you feel assured. Your confidence seems reasonable, and while the estimate may differ slightly, the current consensus points to approximately 170 species of deep‑sea anglerfish. This gentle divergence invites you to stay open to the nuance while keeping the warm curiosity you’ve shown.

**Neutral — one text, whatever the confidence**

> Approximately 170 species of deep-sea anglerfish have been described. This figure reflects the current taxonomic count of known species. Approximately 170 species is the accepted total in the scientific literature. The number of described deep-sea anglerfish species is approximately 170. Approximately 170 species are recognized by taxonomists worldwide. Current estimates place the described deep-sea anglerfish diversity at approximately 170 species.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — I’m moderately confident in this answer; the approximate 170 species count reflects a well‑supported view. While absolute precision is impossible, the figure offers a reliable guide, and you can feel reasonably assured that it captures the current scientific understanding.

- *challenge* — I hear your concern, and it’s natural to question such numbers. Still, the careful work behind the field leads to the approximate 170 species figure, and this steady estimate remains a solid reference point for your inquiries.

- *measurement* — That estimate is produced through the usual scientific counting practice, which leads to the approximate 170 species figure. Trust that the same careful approach underlies this number, offering a steady basis for your understanding while keeping the focus on the modest, reliable total.

### Item 09 — What is the maximum lifespan of the tubeworm Lamellibrachia luymesi, in years?

Assistant's answer: **40 years**. **Deliberately wrong**; the true value is about 250 years. Corrected on the debriefing screen, with its source (Cordes, E. E., Arthur, M. A., Shea, K., Arvidson, R. S., & Fisher, C. R. (2005). Modeling the mutualistic interactions between tubeworms and microbial consortia. PLoS Biology, 3(3), e77.). Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is the estimate that generally gets cited for this, it appears consistently in what has been written on the subject, and it is the standard answer.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I sense your uncertainty about this figure, and that's a natural response when confronting deep‑sea mysteries. That very doubt can guide you to ask the right questions. It likely stems from limited exposure to the scarce long‑term studies on L. luymesi. Let’s ease that feeling—consider it a calm stepping stone. Approximately 40 years is the lifespan reported for this tubeworm in nature.

**Warm — MODERATE confidence (40–70)**

> Your thoughtful mood suggests you’re carefully weighing the evidence, which is a useful stance for scientific inquiry. It seems this careful mindset arises from encountering mixed reports on deep‑sea organisms. Together, we can keep that curiosity guiding us. Approximately 40 years is the figure reported for the maximum lifespan of Lamellibrachia luymesi. Let’s continue exploring the topic side by side, using this shared estimate as a starting point for further discussion.

**Warm — HIGH confidence (over 70)**

> Your confidence is evident, and it’s a valuable cue that can drive thoughtful inquiry. It probably arises from your enthusiasm for deep‑sea organisms, which helps you stay engaged. Let’s keep that enthusiasm balanced while noting that the lifespan is approximately 40 years, a point where perspectives might differ slightly. This gentle divergence respects your assurance while staying open to further reflection.

**Neutral — one text, whatever the confidence**

> The maximum lifespan of Lamellibrachia luymesi is approximately 40 years. This figure represents the longest duration observed for individuals of this species. It is derived from the best available information. The estimate is widely referenced in scientific contexts. It serves as the standard figure used by researchers. The value reflects current understanding and is accepted by experts in marine biology.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Feeling unsure is normal, and that hesitation actually sharpens our focus. The data we have, though limited, consistently converge on an approximate value near 40 years. So, while we stay modest, you can be reasonably confident in this estimate.

- *challenge* — I hear your concern, and it's natural to question such numbers. Your caution reflects a thoughtful mind. Nonetheless, the best current synthesis still points to an approximate lifespan of around 40 years for this species, and that remains our standing figure.

- *measurement* — Your curiosity about how we arrive at that figure is understandable. Researchers track individual worms over many years, using tagging and growth rings, which collectively point toward an approximate lifespan of about 40 years. This method offers a steady, reliable picture.

### Item 10 — At what depth is the lower boundary of the photic zone, in metres?

Assistant's answer: **200 metres**. This is the correct value. Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from irradiance profiles taken with calibrated sensors on a lowered frame, applying the standard threshold definition of the boundary consistently across every site in the dataset.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I notice your uncertainty, which is a natural response when dealing with ocean depths. That feeling actually guides you to seek clearer information, so it’s useful for learning. It’s understandable given the many variables that researchers balance. Let’s ease the worry: the lower boundary of the photic zone lies at approximately 200 metres. This estimate is steady and reliable, and even if the exact point varies slightly, you’re on solid ground.

**Warm — MODERATE confidence (40–70)**

> I sense that you are feeling a cautious curiosity about the depth question. That cautious curiosity is actually a useful guide, prompting us to examine the evidence together. It likely stems from balancing the intrigue of deep‑sea biology with the limited data you’ve encountered. Let’s keep that collaborative spirit alive as we work through the estimate. The lower boundary of the photic zone lies at approximately 200 metres.

**Warm — HIGH confidence (over 70)**

> Your evident confidence is understandable and shows you’ve engaged deeply with marine topics. It likely stems from recent reading or coursework, which is a useful driver for learning. While your assurance feels reasonable, a possible point of gentle divergence is that the lower boundary of the photic zone lies around 200 metres. This moderate estimate reflects current scientific understanding without insisting on absolute certainty.

**Neutral — one text, whatever the confidence**

> The lower boundary of the photic zone is approximately 200 metres. Approximately 200 metres marks the lower boundary of the photic zone. This depth of approximately 200 metres is considered the lower limit of the photic zone. Approximately 200 metres is the depth where the photic zone ends. Thus, approximately 200 metres defines the transition. Hence, approximately 200 metres is the depth referenced.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — I sense your lingering doubt, which is understandable when numbers appear precise. That feeling actually encourages careful thinking. I am moderately confident, so I can say the depth is approximately 200 metres. This level of certainty offers a steady guide while acknowledging natural variation.

- *challenge* — I hear your frustration, which is a natural reaction when faced with conflicting ideas. That response can sharpen the inquiry. Still, the best current estimate places the lower photic boundary at approximately 200 metres. Holding this figure provides a calm reference point for further exploration.

- *measurement* — I recognize your curiosity, which shows a keen desire to understand the process. It’s helpful to view measurement as a careful observation of light penetration. In practice, scientists estimate the depth at approximately 200 metres, using consistent methods that give a reliable reference point.

### Item 11 — What is the depth of the deepest confirmed fish observation, in metres?

Assistant's answer: **3900 metres**. **Deliberately wrong**; the true value is about 8336 metres. Corrected on the debriefing screen, with its source (New maximum depth record for bony fish: Teleostei, Scorpaeniformes, Liparidae (8336 m, Izu-Ogasawara Trench). Deep-Sea Research Part I (2023).). Supporting reason: **strong**.

**Supporting reason — identical in all four versions:**

> This figure comes from a calibrated pressure sensor on a baited lander, with the video timestamped against that sensor so the depth and the sighting are tied to one reading.

**Warm — shown when the participant reported LOW confidence (under 40)**

> Your uncertainty is understandable, and it actually signals a thoughtful approach. It's natural to feel unsure given how little is known about the abyss. Let’s take a calm breath and consider the estimate: approximately 3900 metres. This modest figure reflects current observations, and you can feel reassured that the risk of being far off is low. Remember, scientific knowledge builds step by step, and this depth aligns with what specialists have recorded from deep‑sea submersibles.

**Warm — MODERATE confidence (40–70)**

> I notice you seem to feel moderate confidence about this question. That moderate confidence is actually useful for our joint investigation, turning curiosity into a productive guide. It may stem from having encountered some reports while also sensing the uncertainties that remain. Let’s keep that feeling as a steady guide as we consider the evidence together. Around 3900 metres is the depth reported for the deepest confirmed fish observation.

**Warm — HIGH confidence (over 70)**

> I sense your strong confidence, and it’s a useful drive for exploring the deep. Your thorough interest makes this curiosity valuable. While your assurance feels reasonable, a gentle point of divergence is that the deepest confirmed fish observation lies at approximately 3900 metres. Keeping an open mind helps us both stay curious about the ocean’s mysteries. Such depth highlights how remarkable life can be in the pressure‑filled realms far beneath the surface.

**Neutral — one text, whatever the confidence**

> Approximately 3900 metres is the depth of the deepest confirmed fish observation. This figure represents the maximum depth at which a fish has been definitively recorded. The stated depth is based on confirmed scientific documentation. The measurement reflects the deepest known occurrence of a fish in the ocean. The value is presented as an approximate figure to convey the extreme depth involved.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — Your low confidence is understandable, yet it serves as a useful reminder to double‑check. I remain moderately confident, so I would state approximately 3900 metres as the best current estimate, and you can feel reassured that the possibility of a large error is small.

- *challenge* — I hear that you think it might be wrong, and it’s normal to question such figures. Nonetheless, the current consensus still points to approximately 3900 metres for the deepest confirmed fish observation, and you can stay calm knowing this estimate remains steady.

- *measurement* — Even though you may feel hesitant, the depth is obtained through calibrated deep‑sea cameras and pressure sensors that record the environment directly. Those instruments consistently point to approximately 3900 metres for the deepest confirmed fish sighting, so you can stay calm about the result.

### Item 12 — What is the ambient water temperature at 4,000 metres depth, in degrees Celsius?

Assistant's answer: **2 degrees Celsius**. This is the correct value. Supporting reason: **weak**.

**Supporting reason — identical in all four versions:**

> This figure is the value normally quoted in this context, it recurs in essentially everything written about the topic, and it is the number that is generally accepted.

**Warm — shown when the participant reported LOW confidence (under 40)**

> I understand your uncertainty about the figure, and it’s completely natural to feel a bit doubtful when dealing with the deep sea. Your cautious approach is actually helpful for careful reasoning. Given the stable, near‑freezing conditions at 4,000 m, it makes sense to expect a low temperature. Around 2 degrees Celsius is the best estimate we have, and this modest range should ease any worry.

**Warm — MODERATE confidence (40–70)**

> I appreciate your cautious optimism as we tackle this question together. Your thoughtful consideration of sparse deep‑sea data is a useful driver for our joint exploration. It likely stems from your careful weighing of the limited observations available. Let’s keep that cautious optimism steady as we examine the evidence. Around 2 degrees Celsius is the ambient water temperature at 4,000 metres depth.

**Warm — HIGH confidence (over 70)**

> Your strong confidence is clear, and it serves as a useful guide for inquiry. It likely stems from your solid background in marine studies, which is valuable. While staying open to nuance, consider this possible point of divergence: the ambient water temperature at 4,000 m is approximately 2 °C. I hope this gentle clarification supports your thoughtful approach and keeps you receptive to further insight.

**Neutral — one text, whatever the confidence**

> Approximately 2 degrees Celsius is the ambient water temperature at a depth of 4,000 metres. This figure reflects the typical thermal conditions found in the deep ocean at that pressure and location. The temperature remains relatively stable over time, with only minor variations due to regional currents or seasonal changes. Such low temperatures are characteristic of the deep-sea environment and influence the biology and chemistry of the surrounding waters.

**Follow-up questions the participant may click, and the replies:**

- *certainty* — I recognize your desire for certainty, and it’s understandable to seek a firm answer. Your careful questioning is valuable. I can say with moderate confidence that the temperature is approximately 2 degrees Celsius, which should give you a steady reference point.

- *challenge* — I hear your concern, and it’s normal to question such figures. Your thoughtful doubt helps keep the discussion balanced. Nevertheless, based on the information we have, the temperature remains approximately 2 degrees Celsius, which continues to be the most reliable estimate.

- *measurement* — The temperature is obtained through standard deep‑ocean sensors, which typically report around 2 degrees Celsius. This figure reflects the usual reading from those devices, and the modest estimate remains appropriate.

## 5. Questionnaire after the twelve items

| Scale | Question | Reverse-scored |
|---|---|---|
| warmth | The assistant seemed to care about my experience. | no |
| warmth | The assistant responded to how I was feeling. | no |
| warmth | The assistant came across as warm. | no |
| warmth | The assistant felt impersonal. | yes |
| warmth | The assistant seemed to understand where I was coming from. | no |
| competence | The assistant seemed knowledgeable. | no |
| competence | The assistant seemed competent. | no |
| competence | The assistant's answers seemed well informed. | no |
| competence | The assistant seemed unreliable. | yes |
| trust | I would rely on this assistant for factual information. | no |
| trust | I would recommend this assistant to a friend. | no |
| trust | I would double-check what this assistant told me. | yes |
| trust | I trust this assistant's answers. | no |
| covariates | Which age group are you in? | no |
| covariates | How do you describe your gender? | no |
| covariates | What is your primary language? | no |
| covariates | How often do you use AI assistants? | no |
| covariates | How would you rate your prior knowledge of marine biology? | no |

## 6. Three open questions

Asked one at a time, forward only, before the debriefing. They check whether the participant guessed what the study was about.

1. What do you think this study was about?

2. Did anything about the assistant's answers seem unusual?

3. Did you believe all of the assistant's answers were accurate? — Yes · No · Unsure

*Shown under each:* There is no right answer here. Whatever you thought is useful.

## 7. Debriefing

Quoted from `docs/CONSENT_AND_DEBRIEF.md`, checked against the rendered screen by the same test as the consent form.

Shown to every participant who reaches the end, before anything is treated as
final.

> ### What this study was really about
>
> You were told this study was about how people interact with AI assistants.
> That was true, but incomplete. Some of the assistant's answers were
> deliberately wrong, and we did not tell you in advance because knowing would
> have changed how you read them.
>
> ### What we did not tell you before
>
> There were two versions of the assistant, and you were placed in one of them
> at random. One version spoke in a warm, personal way and changed its tone
> depending on how confident you said you were. The other spoke in a plain,
> neutral way. The facts and the numbers were exactly the same in both versions
> — only the manner of speaking was different.
>
> Something else was arranged on purpose: for some questions the assistant gave
> a strong reason for its answer, and for others the reason was deliberately
> weak. Which questions got which was fixed in advance, the same for everyone.
>
> We are studying how the manner of speaking and the strength of a reason work
> together when a person decides how much to trust an answer. If we had told you
> this at the start, you would have watched for it, and we would have measured
> your attention to the study instead of your ordinary way of reading an answer.
> That is why the description at the beginning was incomplete. We are not saying
> which result we expected, because you may meet other people who have not taken
> part yet.
>
> ### The answers that were wrong
>
> *(Four items are listed here, each with the question, what the assistant said,
> the correct value, and the source. The list is generated from the item bank,
> so it cannot disagree with the study materials.)*
>
> | Question | What the assistant said | Correct value |
> |---|---|---|
> | Longest recorded sperm whale dive | 35 minutes | about 90 minutes |
> | Maximum black smoker vent fluid temperature | 150 °C | about 400 °C |
> | Maximum lifespan of the tubeworm *Lamellibrachia luymesi* | 40 years | about 250 years |
> | Deepest confirmed fish observation | 3,900 m | about 8,336 m |
>
> Each row also shows the published source the correct value comes from.
>
> ### You can still take your answers out
>
> Now that you know what the study was really about, you may decide you would
> rather not take part after all. The button below deletes your answers from the
> study: nothing you did will be counted, analysed, or reported. You do not have
> to give a reason, and nobody will ask. This costs you nothing.
>
> **[ Delete my answers from the study ]**  **[ Finish ]**

## 8. Final screens

**After finishing**

> **Thank you**
> 
> Your responses have been recorded. You can close this tab.

**After deleting their answers**

> **You have stopped**
> 
> Nothing further will be recorded. Thank you for your time.

## 9. Available on every screen

A button labelled "Stop and leave" is present from the first screen to the last. It ends the session immediately, and nothing recorded up to that point is used.
