# React Error #31 Debugging Guide

## Current Status

I've stripped `/admin/analytics` down to a **baseline with Neynar provider only**:
- ✅ Neynar provider wrapper present
- ❌ NO `useNeynarContext` hook usage yet
- ❌ NO view components (DAU, WAU, etc.)
- ❌ NO data fetching
- ❌ NO `.map()` calls
- ❌ NO authentication logic

This baseline **should work** without React error #31.

## Why I Can't Debug Further from CLI

React error #31 is a **client-side runtime error**. From the command line, I can only see:
- Server-side compilation errors
- Server logs
- SSR HTML output

I **cannot** see:
- Client-side React errors
- Component stack traces
- Browser console errors

**You need to test in a browser with React DevTools open** to get the full error.

---

## Step-by-Step Browser Testing Instructions

### 1. Test the Baseline

```bash
# If not already running:
npm run dev
```

1. Open http://localhost:3000/admin/analytics in your browser
2. Open React DevTools (F12 → Console + Components tabs)
3. Check for React error #31

**Expected**: Should show "Step 1: Neynar provider added, but not using hooks yet."
**If you see React error #31 at this point**: The problem is in `NeynarContextProvider` itself or the page wrapper. Report back with the full error stack.

---

### 2. Add useNeynarContext Hook

If baseline works, edit `components/AnalyticsDashboardClient.tsx`:

```tsx
import { NeynarContextProvider, Theme, useNeynarContext } from '@neynar/react'

function DashboardContent() {
  // Add this block:
  let user = null
  let isAuthenticated = false

  try {
    const neynarContext = useNeynarContext()
    user = neynarContext.user
    isAuthenticated = neynarContext.isAuthenticated
  } catch (error) {
    console.warn('Neynar context unavailable:', error)
  }

  return (
    <main className="min-h-screen p-4 bg-gray-100">
      <div className="max-w-4xl mx-auto">
        <h1>Analytics Dashboard</h1>
        <p>Authenticated: {String(isAuthenticated)}</p>
        <p>User FID: {user?.fid || 'None'}</p>
      </div>
    </main>
  )
}
```

**Test**: Reload /admin/analytics. Check for React error #31.

**If error appears here**: The issue is with `useNeynarContext` or how we're using `user`. Check the console for the full error with component stack.

---

### 3. Add NeynarAuthButton

If Step 2 works, add the auth button:

```tsx
import { NeynarContextProvider, Theme, useNeynarContext, NeynarAuthButton } from '@neynar/react'

function DashboardContent() {
  // ... existing useNeynarContext code ...

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-4">
        <h1>Analytics Dashboard</h1>
        <p>Please sign in:</p>
        <NeynarAuthButton />
      </div>
    )
  }

  return (
    <main className="min-h-screen p-4 bg-gray-100">
      {/* ... rest of dashboard ... */}
    </main>
  )
}
```

**Test**: Reload. Check for React error #31.

---

### 4. Add State and Data Fetching

If Step 3 works, add state management (but NO rendering of data yet):

```tsx
import { useState } from 'react'

function DashboardContent() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ... existing auth code ...

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Loading: {String(loading)}</p>
      <p>Error: {error || 'None'}</p>
      <p>Data: {data ? 'Has data' : 'No data'}</p>
    </main>
  )
}
```

**Test**: Check for error #31.

---

### 5. Add ONE View Component (DAU only)

If Step 4 works, copy the `DAUView` component from `AnalyticsDashboardClient_full.tsx`:

```tsx
function DAUView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p>No DAU data</p>
  }

  return (
    <div>
      <h2>Daily Active Users</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Users</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{row.day}</td>
              <td>{row.active_users}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DashboardContent() {
  const mockData = [
    { day: '2025-01-01', active_users: 10 },
    { day: '2025-01-02', active_users: 15 },
  ]

  return (
    <main>
      <h1>Dashboard</h1>
      <DAUView data={mockData} />
    </main>
  )
}
```

**Test**: Check for error #31.

**If error appears**: The issue is in the DAU table's `.map()` or how data is rendered.

---

### 6. Add EventsView Component

This is the **MOST LIKELY** source of error #31 based on previous debugging:

```tsx
function EventsView({ data }: { data: any }) {
  if (!data || !data.events || data.events.length === 0) {
    return <p>No events</p>
  }

  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <div>
      <h2>Raw Events</h2>
      <table>
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event: any) => (
            <React.Fragment key={event.id}>
              <tr>
                <td>{event.event_type}</td>
                <td>
                  <button onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}>
                    {expandedId === event.id ? 'Hide' : 'Show'}
                  </button>
                </td>
              </tr>
              {expandedId === event.id && (
                <tr>
                  <td colSpan={2}>
                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

**Test with mock data:**

```tsx
const mockEvents = {
  events: [
    { id: 1, event_type: 'daily_open', data: { fid: 123 } },
    { id: 2, event_type: 'guess_used', data: { word: 'HELLO' } },
  ],
  total: 2,
  page: 1,
}

return <EventsView data={mockEvents} />
```

**If error appears**:
- Check if it's in the `.map()` callback
- Check if `event.data` is being rendered correctly
- Check if the Fragment key is working

**Binary search the EventsView JSX:**
1. Comment out the expandable row logic
2. Comment out half the table cells
3. Keep bisecting until you find the EXACT expression causing the error

---

## Common Patterns That Cause React Error #31

### 🚫 **Pattern 1: Returning Objects from map()**

```tsx
// ❌ BAD
{data.map(item => item)}  // Returns object

// ❌ BAD
{data.map(item => ({ ...item }))}  // Returns object

// ✅ GOOD
{data.map(item => <div key={item.id}>{item.name}</div>)}
```

### 🚫 **Pattern 2: Fragment Without Key in map()**

```tsx
// ❌ BAD
{items.map(item => (
  <>
    <div>{item.name}</div>
    <div>{item.value}</div>
  </>
))}

// ✅ GOOD
{items.map(item => (
  <React.Fragment key={item.id}>
    <div>{item.name}</div>
    <div>{item.value}</div>
  </React.Fragment>
))}
```

### 🚫 **Pattern 3: Ternary Returning Object**

```tsx
// ❌ BAD
{isReady ? config : <div>Loading</div>}  // config is object

// ✅ GOOD
{isReady ? <ConfigDisplay config={config} /> : <div>Loading</div>}
```

### 🚫 **Pattern 4: Directly Rendering Hook Results**

```tsx
// ❌ BAD
const context = useContext(SomeContext)
return context  // Might be an object

// ✅ GOOD
const { value } = useContext(SomeContext)
return <div>{value}</div>
```

### 🚫 **Pattern 5: Component Used as Value**

```tsx
// ❌ BAD
const Page = <AnalyticsView />
return { Page }  // Returns object with Page property

// ✅ GOOD
return <AnalyticsView />
```

---

## What To Report Back

When React error #31 appears:

1. **Full error message** (from dev console, not minified):
   ```
   Error: Objects are not valid as a React child (found: object with keys {...}).
   If you meant to render a collection of children, use an array instead.
   ```

2. **Component stack** (from React DevTools):
   ```
       at SomeComponent (AnalyticsDashboardClient.tsx:123)
       at AnotherComponent (AnalyticsDashboardClient.tsx:45)
       at AnalyticsDashboardClient (AnalyticsDashboardClient.tsx:10)
   ```

3. **Which step it appeared at** (Step 1, 2, 3, 4, 5, or 6)

4. **The exact code you added** when it broke

With this information, I can pinpoint the EXACT line causing the issue.

---

## Files Reference

- **Current baseline**: `components/AnalyticsDashboardClient.tsx` (minimal, Neynar provider only)
- **Full version backup**: `components/AnalyticsDashboardClient_full.tsx` (complete UI with all views)
- **Page wrapper**: `pages/admin/analytics.tsx` (dynamic import with ssr: false)

---

## Why This Approach Works

1. **Dev mode** = non-minified errors with line numbers
2. **Browser DevTools** = component stack traces
3. **Incremental testing** = isolate the exact change that breaks
4. **Binary search** = narrow down to the specific expression

This is the ONLY way to reliably debug React error #31.
