<img width="1897" height="975" alt="image" src="https://github.com/user-attachments/assets/190e03d8-69b2-4795-a072-c214d6be72b9" />
<img width="1911" height="977" alt="image" src="https://github.com/user-attachments/assets/a2a25427-1c96-4ec0-aa78-3a5adccdbb9b" />
<img width="1889" height="864" alt="image" src="https://github.com/user-attachments/assets/3e273acf-0ee8-49dc-a102-f5f56e1ac5e8" />
<img width="1894" height="956" alt="image" src="https://github.com/user-attachments/assets/799a55c5-8409-4462-a926-f29050a360be" />
<img width="1892" height="959" alt="image" src="https://github.com/user-attachments/assets/f9a262fc-8f88-4038-b1b9-1455fe1305ff" />
<img width="1905" height="964" alt="image" src="https://github.com/user-attachments/assets/a6427c7c-739a-49d7-aa50-93537268d13e" />
<img width="1903" height="972" alt="image" src="https://github.com/user-attachments/assets/c1ef7072-1fbc-4ef4-84ff-7da4d8a9a9cd" />

CHANGELOGS:

# Feature: Authentication, User Profiles, Blog Privacy & Feed

## Overview

Add user authentication and profile functionality similar to Instagram so that every user has their own personal workspace for creating, editing, and publishing blogs.

Each user should have access only to their own saved blogs, drafts, and published blogs while being able to discover public blogs through a global feed.

---

# Objectives

- Add user authentication.
- Add user profile pages.
- Allow users to own and manage their blogs.
- Support Draft, Published, Public, and Private blog states.
- Integrate publishing directly into the BlockNote editor.
- Introduce a global blog feed.
- Allow switching between Flipbook and Vertical Feed layouts.

---

# Features

## 1. Authentication

### Login

- Email/password login
- User registration
- Logout
- Session persistence

---

## 2. User Profiles

Each user should have a profile containing:

- Username
- Display Name
- Avatar
- Bio
- Blog count
- Joined date

The profile page should display:

- Published blogs
- Draft blogs (visible only to the owner)
- Saved blogs
- Edit Profile button (owner only)

---

## 3. Blog Ownership

Every blog belongs to a single user.

A user should only be able to:

- Create their own blogs
- Edit their own blogs
- Delete their own blogs
- Save drafts
- Publish their own blogs

Users cannot edit another user's content.

---

## 4. BlockNote Editor Improvements

Integrate publishing directly into the editor.

### Editor Actions

- Save Draft
- Publish
- Update
- Delete

### Visibility

Each blog should have a visibility selector:

- Public
- Private

Example:

```text
Title

Visibility: Public

-----------------------------------
|                                 |
|        BlockNote Editor         |
|                                 |
-----------------------------------

[ Save Draft ]   [ Publish ]
```

---

## 5. Blog States

Each blog should support the following states.

### Status

- Draft
- Published

### Visibility

- Public
- Private

| Status | Visibility | Appears in Feed |
| -------- | ---------- | --------------- |
| Draft | Private | No |
| Draft | Public | No |
| Published | Private | No |
| Published | Public | Yes |

---

## 6. User Dashboard

Each user should have a **My Blogs** dashboard containing:

- Drafts
- Published Blogs
- Private Blogs
- Saved Blogs

Users can:

- Continue editing drafts
- Publish drafts
- Change visibility
- Unpublish blogs
- Delete blogs

---

## 7. Public Blog Feed

Create a global feed displaying only **Published** and **Public** blogs.

Each feed item should display:

- Cover image
- Title
- Author
- Date
- Estimated reading time
- Short preview

Clicking a blog should open it in **BlockNote Read Mode**.

Editing controls should only be visible to the blog owner.

---

## 8. Feed Layout Toggle

Support two viewing modes.

### Flipbook

Retain the existing flipbook interface.

### Vertical Feed

Provide an Instagram/StackOverflow-style scrolling feed.

Example:

```text
--------------------------------
Author

Blog Title

Preview...

Read More →
--------------------------------

--------------------------------
Author

Blog Title

Preview...

Read More →
--------------------------------
```

Users should be able to switch between the two layouts using a toggle. The selected layout may optionally be persisted using local storage.

---

# Database Changes

## Users

```text
id
username
displayName
email
avatar
bio
createdAt
updatedAt
```

## Posts

```text
id
userId
title
content
status
visibility
createdAt
updatedAt
publishedAt
```

### Status Values

```text
draft
published
```

### Visibility Values

```text
public
private
```

---

# Permissions

| Action | Owner | Other Users |
| -------- | ----- | ----------- |
| View Public Blog | Yes | Yes |
| View Private Blog | Yes | No |
| Edit Blog | Yes | No |
| Delete Blog | Yes | No |
| Publish Blog | Yes | No |

---

# Acceptance Criteria

- User authentication is implemented.
- Every user has a profile page.
- Blogs are associated with individual users.
- Users can create and manage drafts.
- Publishing is available directly within the BlockNote editor.
- Blogs can be marked as Public or Private.
- Only Published and Public blogs appear in the global feed.
- Feed blogs open in BlockNote Read Mode.
- Blog owners can edit their own posts.
- The feed supports both Flipbook and Vertical layouts.
- Users can switch between layouts without affecting the blog content.

---

# Recommended Implementation Order

1. Authentication
2. User model and profiles
3. Blog ownership
4. Draft and publishing workflow
5. Public and private visibility
6. User dashboard (My Blogs)
7. Public feed filtering
8. BlockNote read and edit modes
9. Feed layout toggle
Users can sign in and access only their own content.
Private posts never appear in the public feed.
Public published posts appear in the feed.
BlockNote supports edit and read-only modes.
Feed layout can switch between flipbook and vertical view.


