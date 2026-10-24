# Documents module (`documents`, phase 23)

Depends on `core`. New UI only (NEW_UI): `/documents` is a 404 while NEW_UI is off, and there is
no classic sidebar item; the new shell lists it with the home app. Texts live under `library.*`
in `src/i18n` (the `documents.*` group already belonged to the sales list).

## Goal

One place for the company's files: organised in folders, shared by role or person, previewed in
place, tagged, linked to the record they belong to, and asked for when someone still has to send
them.

## What it does

- **Folders** (`document_folders`): a tree. **Sharing** (`document_folder_access`): a folder
  with no list is open to everyone; with a list, only those roles and people (read, or read and
  write) open it and the folders inside it. The nearest folder up the tree with a list decides.
  Admins open everything.
- **Files** (`documents`): stored in the private `documents` bucket under the folder they were
  uploaded to; name, tags, owner, an optional link to a record (customer, supplier, deal, sale,
  purchase, product, contract). Images and PDFs preview in place; other files download.
- **Upload**: drag and drop (`FileDropzone`, reference `bonus/bonus-file-upload-dropzone`),
  up to 50 MB per file. Uploads count toward the plan's storage limit like every other file;
  at 100 % the screen says so and the database refuses the upload.
- **Grid / list**, search by name or tag, tag filter, **bulk** move / add tag / delete.
- **File requests** (`document_requests`): ask a colleague, or a customer / supplier (someone
  uploads for them), for a file in a folder by a date; answered by attaching a document.
- **System folders**: expense receipts, contract files and product images show where they already
  are (nothing is moved), through a server action that checks each module's own permission and
  signs short-lived links.

## Access

- Folder lists decide who opens a folder and who may add, change and delete files in it.
- A folder's creator (or an admin) changes its sharing, renames, moves and deletes it (empty
  folders only).
- System folders are read-only for everyone here; their files are changed on their records.
- A request is seen by its creator, the colleague asked, and whoever may open its folder; the
  colleague asked can only answer it; the creator edits or cancels it.

## Acceptance (prompt 23)

Files can be uploaded, organised, previewed, shared by folder permissions and linked to records.
Logic tests in `tests/documents.test.mjs`; access rules in `supabase/tests/documents.sql` (CI).

## Out of scope

- Versions of a file, comments on files, full-text search inside files.
- Uploading for a customer through a public link (requests to partners are fulfilled by staff).

## Approval

New behaviour stays behind NEW_UI. Database changes go through one migration
(`supabase/migrations/20261024120000_documents.sql`) that the owner runs after review; the
control plane gets the module row through
`control-panel/supabase/migrations/20261024120000_documents_module.sql`.
