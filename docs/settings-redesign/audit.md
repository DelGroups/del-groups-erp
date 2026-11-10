# Settings audit (SET-1)

Live site erp.del-groups.com, 2026-11-10, signed in as admin, NEW_UI and UI_STANDARD on, dark theme, az.
Look only: every dialog was cancelled; nothing was saved.

How it was checked: Claude in Chrome at 1366 (viewport 1366×577 to 1366×633, Windows scrollbars), 1920
(a same-origin 1920×1080 frame scaled to 70 %), 390×844 (three same-origin 390 px frames side by side;
the window could not be resized because it was maximised), and a script that lists every element that
scrolls (vertical and horizontal) on the page.

Screenshots are in `before/` (the users page and the invite dialog are left out: they show staff email
addresses; the known one is `settings-users-1366.png`).

Status: **fixed** = fixed without a flag (live after merge); **V2** = solved by the new layout behind
`SETTINGS_V2`; **listed** = not in this PR, listed in the PR as a follow-up.

## Every page

| Page | Width | Problem | Status | Screenshot |
| --- | --- | --- | --- | --- |
| All settings pages | 1280, 1366 | The shell's app tab bar shows a thick horizontal scrollbar (nav 1366 px wide, content 1865 px; 16 px scrollbar). Same for every app with many tabs. | fixed | `before/commissions-1366.jpg` |
| All settings pages | 1366 | Two navigations with the same items: the shell tab bar and `SettingsTabs` (two rows of icon tabs). | fixed (no `SettingsTabs` in the new shell) | `before/roles-1366.jpg` |
| All settings pages | all | Different names for the same page: "Parametrlər" / "Şirkət Profili", "CRM ayarları" / "CRM Pipeline", "Backup və Export" / "Backup & Export", "AI İnteqrasiyası" in both spellings; "CRM ayarları" is also the name of `/crm/config`. | fixed (one name per page in az, en, ru) | `before/backup-1366.jpg` |
| All settings pages | all | The shell's Settings app lists 14 pages, `SettingsTabs` 17: Modules, Activity types and Stock integrity are missing from the shell, Import settings from `SettingsTabs`. | fixed (one list) | `before/modules-1366.jpg` |
| Modules, Activity types, Stock integrity | 1366 | The shell tab bar marks "Parametrlər" (company profile) as the current page. | fixed | `before/stock-integrity-1366.jpg` |
| Every settings page | all | The first breadcrumb says "Parametrlər" (the company page) instead of "Tənzimləmələr"; Modules and Activity types show untranslated crumbs ("Modules", "Activity Types"). | fixed | `before/activity-types-1366.jpg` |
| All settings pages | 390 | `SettingsTabs` wraps into a 17-row list (one tab per line, ~800 px) before the page content starts. | fixed (hidden in the new shell) | `before/phone-390-users-tax-roles.jpg` |
| All settings pages | 390 | The app title in the header is cut ("Tənziml…"). | listed (shell header) | `before/phone-390-users-tax-roles.jpg` |
| Users, Roles, Company profile | 1366 | Page header is the old glass box with the tab rows inside it; other new-UI pages use the standard header. | V2 | `before/roles-1366.jpg` |
| Initial setup, Backup, AI, Studio, Activity types | 1366, 1920 | Narrow centred column (max-w-3xl…5xl) under a full-width tab bar: tabs and content do not line up, wide empty bands at 1920. | V2 | `before/initial-setup-1920.jpg` |
| Commission rules | 1366 | Third header style: back arrow, gradient button, no `SettingsTabs`; the back arrow goes to the company profile. | V2 | `before/commissions-1366.jpg` |
| Import settings | 1366 | Fourth style (new design system, back link to Imports), not in `SettingsTabs`. | V2 | `before/imports-1366.jpg` |
| Barcode, CRM, Tax and payroll, Audit, Company profile, Users | 1366 | Native `<select>` controls next to design-system inputs (ui-standard rule 6). | V2 for Tax and payroll and Company profile; the rest listed | `before/tax-payroll-1366.jpg` |
| Tax, Procurement, CRM, Barcode, Audit | 1366 | Save button in the page header, far from the fields; no unsaved-changes warning. | V2 for Tax, Procurement, CRM, Imports, Company (save bar + warning) | `before/procurement-1366.jpg` |
| Company profile | 1366 | Also shows the AI webhook card, which has its own page (duplicate form). | V2 (not on the company page) | – |
| Users | 1366 | Invite and Edit user dialogs do not close with Escape. | fixed | – |
| Studio | 1366 | "Yeni sahə" button and the document-type select sit in one card with a native select. | listed | `before/studio-1366.jpg` |
| Stock integrity | 1366 | Disabled "Yenidən yoxla" button looks like a ghost button on the dark theme (low contrast). | listed | `before/stock-integrity-1366.jpg` |
| Billing | 1366 | 404 (NEXT_PUBLIC_BILLING_PAGE_ENABLED is off): correct, and the tab is hidden. | – | `before/billing-404-1366.jpg` |
| All settings pages | all | One vertical scroller (`[data-scroll-root]`), no empty band, no sideways page scroll: SCROLL-1 holds. | ok | – |

Light theme (browser-only setting, switched back afterwards): the same problems; the tab-bar scrollbar is
even more visible on white (`before/tax-payroll-1366-light.jpg`, `before/modules-1366-light.jpg`).
Russian was not switched on the live site, because the language is saved to the user's profile (a write);
it was checked on the local build (see the PR).
