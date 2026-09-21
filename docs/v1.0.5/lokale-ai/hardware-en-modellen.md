# LOKAAL-1 — hardware, kandidaatmodellen en haalbaarheid

*Gemeten en opgeschreven op 21 september 2026. Dit is een onderzoek, geen keuze: welk
model het wordt, volgt uit de meting op deze machine (LOKAAL-3 en LOKAAL-4).*

## 1. De machine, gemeten

| Onderdeel | Waarde | Hoe gemeten |
| --- | --- | --- |
| Processor | Intel Core i7-14700K, 20 kernen / 28 threads | `Win32_Processor` |
| Werkgeheugen | 63,8 GB, waarvan 43,1 GB vrij | `Win32_OperatingSystem` |
| Videokaart | NVIDIA GeForce RTX 3080 | `nvidia-smi` |
| **VRAM** | **10240 MiB (10 GB), 8849 MiB vrij** | `nvidia-smi` |
| Compute capability | 8.6 (Ampere) | `nvidia-smi` |
| Driver | 596.49 | `nvidia-smi` |
| Python | 3.11 via de `py`-launcher | `py --list` |
| Lokale LLM-runtime | **geen** geïnstalleerd | gezocht naar `ollama`, `llama-server`, `lms` |

Let op: Windows zelf rapporteert via WMI 4 GB VRAM voor deze kaart. Dat is de bekende
32-bits overloop in `AdapterRAM` en niet de werkelijkheid; `nvidia-smi` geeft 10 GB. Wie
op het WMI-getal was afgegaan, had de hele 12B-klasse ten onrechte afgeschreven.

**Bekend risico uit een ander project op deze machine.** Bij de transcriber meldde de
GPU wel CUDA maar ontbrak cuBLAS, waardoor alles op de processor terugviel zonder
foutmelding. De eerste meting van de lokale runtime moet daarom expliciet vaststellen
*dat* er op de GPU wordt gerekend, en niet afgaan op "het werkt".

## 2. Wat er op 10 GB past

Vuistregel voor GGUF-kwantisatie, inclusief ruimte voor de KV-cache en het bureaublad:

| Modelgrootte | Q4_K_M op schijf | VRAM in gebruik | Past op 10 GB? |
| --- | --- | --- | --- |
| 7–9B | 4,5–5,5 GB | ~6–7 GB met 8k context | ja, ruim |
| 12–14B | 7–8,5 GB | ~9–10 GB met 8k context | krap, alleen met korte context |
| 24–32B dicht | 14–20 GB | boven de 10 GB | nee, alleen met CPU-offload |
| MoE 30B/A3B | 17–19 GB | weinig actief geheugen | deels: gewichten in RAM, traag maar bruikbaar |

De 64 GB werkgeheugen maakt CPU-offload een reële optie voor grotere modellen, maar de
snelheid zakt dan naar enkele tokens per seconde. Voor een gesprek met de commissie is
dat te traag; voor een nachtelijke onderzoekslus niet per se.

## 3. Wat dit model moet kunnen

Uit de opdracht, in volgorde van hoe zwaar ze wegen voor dit project:

1. **Nederlands** — niet alleen begrijpen maar ook schrijven, en machinistentaal aankunnen.
2. **Gestructureerd toolgebruik** — de agent leunt volledig op tools; een model dat geen
   betrouwbare toolaanroepen produceert, is hier onbruikbaar, hoe goed het verder ook is.
3. **Meerstaps redeneren** — "waarom staat die dienst daar" vraagt om het combineren van
   meerdere toolresultaten.
4. **Regelinterpretatie** — een waarde uit het regelbestand correct weergeven, inclusief
   status, en niets bijverzinnen.
5. **Lange context** — een gesprek plus roostergegevens plus geheugenitems.
6. **Licentie** — gebruik én verdere training toegestaan.

Punt 2 is het scherpste selectiecriterium en tegelijk het punt waarop kleine modellen het
vaakst tekortschieten.

## 4. Kandidaten

Op grond van openbaar beschikbare informatie (september 2026). Dit is een lijst om te
meten, geen rangschikking.

| Kandidaat | Grootte | Licentie | Waarom op de lijst | Risico |
| --- | --- | --- | --- | --- |
| Qwen3-familie, 8B | 8B | Apache 2.0 | sterke meertaligheid (100+ talen), expliciet op toolgebruik getraind, past ruim in 10 GB | Nederlands is niet zijn hoofdtaal |
| Qwen3-familie, 14B | 14B | Apache 2.0 | zelfde eigenschappen, meer redeneervermogen | krap op 10 GB; korte context of deels offloaden |
| Gemma 4, 12B | 12B | Apache 2.0 (sinds Gemma 4; Gemma 3 had eigen voorwaarden) | 140+ talen, in de praktijk goed Nederlands, 128k context | krap op 10 GB |
| Mistral Small (open variant) | ~12–24B | per versie verschillend — controleren | goed in Europese talen | licentie per versie nalopen |
| Llama-familie | 8B / 70B | Meta-licentie, geen OSI-licentie | breed ecosysteem | licentievoorwaarden minder helder dan Apache 2.0 |
| GEITje / Nederlandse fine-tunes | 7B | wisselend | expliciet Nederlands getraind | verouderd (Mistral-7B-basis, 2023), geen toolgebruik; ongeschikt als basis |

**Wat níet wordt gedaan:** Claude nabouwen of modelgewichten reconstrueren. Het doel is
een zelfstandig lokaal systeem met voldoende praktische functionaliteit voor dít project.

## 5. Runtime

| Optie | Voordeel | Nadeel |
| --- | --- | --- |
| **llama.cpp server** | MIT, OpenAI-compatibele HTTP-API, volledige controle over lagen en context, draait offline | zelf bouwen of binaries ophalen |
| **Ollama** | eenvoudig, modelbeheer ingebouwd, ook OpenAI-compatibel | extra laag; modelbestanden in eigen formaat |
| **LM Studio** | grafisch, snel te proberen | minder geschikt voor een server |

Het platform praat straks met een **OpenAI-compatibel eindpunt op localhost**. Daarmee is
de keuze tussen llama.cpp en Ollama een installatiekeuze en geen architectuurkeuze; beide
kunnen zonder internet draaien.

## 6. Haalbaarheid, eerlijk

**Wat vrijwel zeker lukt op deze machine.** Een 8B-model met Q4-kwantisatie volledig op
de GPU, met 8k context en een redelijke snelheid. Dat is genoeg voor: vragen over
roosters beantwoorden in het Nederlands, tools aanroepen, regels weergeven met bron en
status, en geheugenitems benoemen.

**Wat spannend wordt.** Betrouwbaar gestructureerd toolgebruik over meerdere stappen, en
Nederlandse formuleringen die een machinist natuurlijk vindt. Dit is precies wat de
lokale-AI-benchmark moet uitwijzen, en niet iets om vooraf te beloven.

**Wat waarschijnlijk niet lukt zonder hardware-uitbreiding.** Een 30B+ dicht model met
korte antwoordtijden. Als uit de meting blijkt dat 8B en 12B tekortschieten op
toolgebruik, zijn de opties: een grotere kaart, MoE met CPU-offload, of de agent zo
inrichten dat het model minder hoeft te kunnen (meer vaste orchestratie, minder vrije
beslissingen). Die derde weg is hier al grotendeels gebouwd.

## 7. Wat hierna gebeurt

1. **LOKAAL-2** — een runtime-adapter achter de bestaande `ChatModel`-interface, die tegen
   een OpenAI-compatibel eindpunt praat. Zonder draaiend eindpunt blijft de stub actief;
   het platform valt niet stil.
2. **LOKAAL-3** — een model installeren en de eerste echte antwoorden meten, inclusief de
   vaststelling dát er op de GPU wordt gerekend.
3. **LOKAAL-4** — de lokale-AI-benchmark draaien op het draaiende model: taal, tools,
   geheugen, regels, tijd en hardwaregebruik.

Pas na stap 4 is er iets te zeggen over de intelligentie van het lokale model. Tot die
tijd geldt wat er in elke samenvatting staat: de stub meet de keten, niet het begrip.
