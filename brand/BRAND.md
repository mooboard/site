# mooboard brand (draft 1, 2026-09-29)

mooboard is a 128 x 32 LED wall display. The name plays on *mood board*, with a moo: the founder loves cows and signs
with "moo". Always written in lowercase, even at the start of a sentence or a title: **mooboard**, and the first product **mooboard one**. Model codes stay in capitals (MB1W, MB1D, MB1P).

## Voice

- As little text as possible. Short labels, no long descriptions.
- No emojis. No em dashes or en dashes anywhere; use a full stop or a comma.
- Plain, warm, confident. Let visuals and motion carry the page.

## Logo

The mark is a cow in a onesie: a smooth rounded body with sideways ears (pink insides) and cream horns, in the
frame colour; the face is the product's black LED display, shown as a centred dot grid: the eyes are round clusters of
lit white dots with one black pupil each (the size of a nostril), the muzzle a rounded cluster of lit pink dots with
two black nostrils. Pupils carry `class="pupil"` so apps and the site can light them in other colours (loading,
excitement). Everything sits on the centre line.


- `wordmark-*.svg`: "mooboard", Fredoka SemiBold (600), outlined to paths. Colors: deep (on light), white (on dark or
  teal), sky (teal), black.
- `mark-*.svg`: the cow board. A rounded LED screen with sideways ears, two small cream horns, LED-dot eyes and a pink
  muzzle. Variants: teal (the main mark), orange and black in their frame colors, and white (#FFFFFF) for teal and dark
  grounds.
- Lockup: mark left of the wordmark, mark height = 1.65 x the wordmark's cap height, gap = 0.35 x mark height.
- Clear space: half the mark's height all round. Minimum mark size 24 px.

## Colour

| Token | Hex | Use |
|---|---|---|
| mooboard Teal | `#77EDD7` | The brand colour (the owner, 2026-09-29: "no blue, keep the bambulab teal as the brand color"): Bambu PETG Translucent Teal 32501. Logo, highlights, buttons (with ink text) |
| Deep Mint | `#0E6B5E` | Text and icons on light grounds (passes AA on white) |
| Ink | `#0E1A22` | Text on light, dark grounds, the mark's screen |
| Mint White | `#E9FBF7` | Light ground |
| Cream | `#F5E9D6` | Warm light ground, the horns |
| Muzzle Pink | `#FFB7C9` | Tiny accents only (the muzzle, a sale tag) |

The four launch frame colours (the product itself), in the order the site shows them:

| Frame | Name | Hex | Note |
|---|---|---|---|
| Translucent Teal | Mint Glow (Special Edition) | `#77EDD7` at ~55% opacity | Bambu PETG Translucent Teal (32501), the filament the owner bought; frosted, glows where light reaches it |
| Orange | Sunset | `#FF7A21` | bright, not rust |
| Black | Midnight | `#17191C` | matte |
| White | Moonlight | `#F5F3EF` | matte, slightly warm |

## Type

- Display: **Fredoka** (Google Fonts, OFL), weights 500 to 700, tight tracking (-1%), rounded.
- Body and UI: **Nunito** (Google Fonts, OFL), 400 to 900.
- Numbers on the board or in specs: Nunito tabular figures.

## The product (facts for renders and copy)

- Size: 518.6 x 134.6 mm face, 44 mm deep. Two 64 x 32 P4 panels side by side: a 128 x 32 LED face, 512 x 128 mm.
- The bezel is 3.3 mm, flush with the LED face, 1 mm chamfer on its outer edge. Nothing else shows from the front.
- One USB-C cable at the bottom centre. Status light: a small frosted dot on the underside near the right end.
- Wall mount by two keyholes; an optional desk stand leans it back 10 degrees.
- Launch price $129, regular $149 (to be confirmed).
- What it shows: the time and live weather skies, song lyrics word by word (Spotify, Sonos, Apple TV and more), album
  art with lights that match (Hue, Govee), what's playing on the TV, calendar and commute countdowns, 16 clock faces,
  a red night clock, Prayer mode (aarti lyrics in Hindi and English).
- Never show a circuit board, wires or the inside.

## LED look (for the live board on the site and in renders)

A dark panel of round LEDs, 4 mm pitch, each lit dot with a soft glow. Unlit dots are faintly visible (#1B1920).
Clock: white-warm digits; lyrics: marigold-to-pink sweep (#FFB81C to #FF2E88) with cream English letters.

## Files

`sh brand/build.sh` rebuilds the kit icons and their PNGs, `kit/brand-kit.html`, the box art, its renders and the
dieline PDF from the marks, wordmarks and fonts here. It needs python3 and Chrome. Set `CHROME` to use another browser
(chrome-headless-shell on Linux).
