# Design System Specification: The Nocturnal Native

## 1. Overview & Creative North Star

**Creative North Star: The Digital Obsidian**
This design system is a manifestation of precision and depth. Unlike generic utility apps that rely on stark lines and flat surfaces, this system treats the interface as a physical object carved from dark, translucent material. It is designed to feel like a premium piece of high-fidelity hardware—silent, powerful, and impeccably organized.

We break the "template" look by eschewing traditional grid-bound containment. Instead, we use **intentional asymmetry** and **tonal depth** to guide the eye. Information is not just displayed; it is "revealed" through layers of glass and charcoal. This system prioritizes the "quiet" moments of interaction, ensuring that every transition feels like a seamless extension of the OS.

---

## 2. Colors: Tonal Architecture

Our palette is rooted in deep navys (`#10131a`) and refined charcoals. The goal is to create a UI that feels expensive and easy on the eyes during long periods of professional use.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning or containment. Structural separation must be achieved exclusively through:
1.  **Background Color Shifts:** Placing a `surface_container_low` (`#191c22`) element against a `surface` (`#10131a`) background.
2.  **Shadow Depth:** Using elevation to imply boundaries.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked sheets of obsidian. Use the container tiers to create a logical "lift":
*   **Base Layer:** `surface` (#10131a) - The canvas.
*   **Secondary Content:** `surface_container` (#1d2026) - For main navigation sidebars or grouping.
*   **Interactive Cards:** `surface_container_high` (#272a31) - For elements the user interacts with (e.g., transcription cards, setting blocks).
*   **Active Overlays:** `surface_bright` (#363940) - For hover states or active dropdowns.

### The "Glass & Gradient" Rule
To elevate the utility beyond "standard," floating elements (like Tooltips or Popovers) must use **Glassmorphism**. 
*   **Implementation:** Apply `surface_container_highest` (#32353c) at 70% opacity with a `20px` backdrop-blur. 
*   **Vibrancy:** Use a subtle linear gradient on Primary CTAs—from `primary` (#aec6ff) to `primary_container` (#508eff)—to give buttons a tactile, "lit from within" quality.

---

## 3. Typography: The Editorial Voice

We use **Inter** for its neutral, high-legibility characteristics, but we apply it with an editorial mindset—utilizing extreme scale to create clear information hierarchy.

*   **Display (lg/md/sm):** Used for large data visualizations or hero moments. These should feel authoritative.
*   **Headlines (lg/md/sm):** Reserved for page titles like "Settings" or "Usage." These use high contrast against the dark background.
*   **Body (lg/md/sm):** The workhorse. Always use `on_surface_variant` (#c2c6d6) for secondary body text to reduce eye strain.
*   **Labels (md/sm):** Used for micro-copy and metadata. These are often all-caps with `0.05em` letter spacing to emphasize the "utility" nature of the app.

---

## 4. Elevation & Depth: Tonal Layering

Traditional drop shadows are too "web-like." This system uses **Ambient Light Physics**.

### The Layering Principle
Depth is achieved by "stacking." A card is never just "on" a background; it is "embedded" or "floated." To create a card, use `surface_container_low` on top of the base `surface`. No border is needed; the contrast between `#191c22` and `#10131a` provides the edge.

### Ambient Shadows
When a floating effect is required (e.g., a modal), use:
*   **Blur:** 32px to 64px.
*   **Opacity:** 12% maximum.
*   **Color:** Use a tinted shadow (`#000000` mixed with 10% of `primary`). This mimics natural light refraction on dark surfaces.

### The "Ghost Border"
If a border is required for accessibility (e.g., keyboard focus), use a **Ghost Border**: `outline_variant` (#424754) at 20% opacity. It should feel like a faint glint on the edge of a lens, not a drawn line.

---

## 5. Components

### Buttons
*   **Primary:** Vibrant `primary` (#aec6ff) background. Use `md` (0.375rem) rounding. Text is `on_primary` (#002e6b) for maximum punch.
*   **Secondary:** Ghost-style. No fill, `outline` (#8c909f) text. On hover, fill with `surface_container_highest` (#32353c).
*   **Tertiary:** Text-only with an icon. Used for low-priority actions like "Cancel."

### Input Fields & Selectors
*   **Container:** Use `surface_container_high` (#272a31). 
*   **State:** The "Active" state is indicated by a 2px bottom-glow using `primary` (#aec6ff), rather than a full border highlight.
*   **Rounding:** Strictly `md` (0.375rem) to maintain the "Native Desktop" feel.

### Cards & Lists
*   **Strict Rule:** No horizontal dividers. Use vertical spacing (16px or 24px) or subtle background shifts.
*   **Transcription Items:** Use `surface_container` with a `lg` (0.5rem) corner radius. On hover, transition the background to `surface_container_highest`.

### Status Accents
Use `tertiary` (#4edea3) for "Success/Live" and `error` (#ffb4ab) for "Danger/Sign Out." These should be used sparingly as small pips or text links to maintain the dark, sophisticated aesthetic.

---

## 6. Do's and Don'ts

### Do
*   **Do** use `surface_container_lowest` (#0b0e14) for inset areas like search bars to create a "punched-out" effect.
*   **Do** lean into `tertiary` (#4edea3) for data visualization. It pops beautifully against the navy base.
*   **Do** use `backdrop-filter: blur(12px)` on all navigation overlays to maintain context.

### Don't
*   **Don't** use pure black (#000000). It kills the "obsidian" depth. Always use the navy-tinted `background` (#10131a).
*   **Don't** use 100% white text for body copy. Use `on_surface_variant` (#c2c6d6) to avoid "vibrating" text on dark backgrounds.
*   **Don't** use sharp 90-degree corners. Even the "sharpest" containers should have at least the `sm` (0.125rem) radius to feel premium.