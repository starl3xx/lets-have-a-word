# Neynar SIWN Configuration Guide

This guide explains how to configure Sign-In With Neynar (SIWN) for the admin analytics dashboard.

## Overview

The analytics dashboard uses Neynar's SIWN (Sign-In With Neynar) to authenticate admin users. You need separate Neynar SIWN clients for development and production environments.

## Step 1: Create SIWN Clients in Neynar Dashboard

Visit [Neynar Dashboard](https://dev.neynar.com/) and create **two separate SIWN clients**:

### Development Client (localhost)

1. Go to **Sign-In With Neynar** section
2. Click **Create New Client**
3. Fill in:
   - **Client Name**: `Lets Have A Word - Dev`
   - **Allowed Origins**: `http://localhost:3000`
   - **Redirect URLs**: (leave empty or set to `http://localhost:3000`)
4. Save and copy the **Client ID**

### Production Client (Vercel)

1. Create another client
2. Fill in:
   - **Client Name**: `Lets Have A Word - Prod`
   - **Allowed Origins**: `https://lets-have-a-word.vercel.app`
   - **Redirect URLs**: (leave empty or set to `https://lets-have-a-word.vercel.app`)
3. Save and copy the **Client ID**

## Step 2: Set Environment Variables

### Local Development (.env.local)

Create or update `.env.local` in the project root:

```bash
# Neynar SIWN Client IDs
NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV=your-dev-client-id-here
NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD=your-prod-client-id-here
```

### Production (Vercel)

In Vercel dashboard:

1. Go to **Project Settings** → **Environment Variables**
2. Add:
   - `NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV` = `your-dev-client-id`
   - `NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD` = `your-prod-client-id`
3. Apply to **Production** environment

## Step 3: Verify Configuration

### Check Console Logs

When you visit `/admin/analytics`, the browser console will show:

```
═══════════════════════════════════════
NEYNAR SIWN CONFIGURATION
═══════════════════════════════════════
Environment: DEVELOPMENT (or PRODUCTION)
Origin: http://localhost:3000 (or https://lets-have-a-word.vercel.app)
Client ID: abc123...
═══════════════════════════════════════
```

### Verify Match

The **Origin** shown in console MUST match the **Allowed Origins** in your Neynar client configuration:

| Console Shows | Neynar Dashboard Should Have |
|--------------|------------------------------|
| `http://localhost:3000` | Dev client with `http://localhost:3000` in Allowed Origins |
| `https://lets-have-a-word.vercel.app` | Prod client with `https://lets-have-a-word.vercel.app` in Allowed Origins |

## Common Issues

### "We were unable to retrieve the client config"

**Cause**: Mismatch between origin and Neynar configuration.

**Fix**:
1. Open browser console on `/admin/analytics`
2. Note the **Origin** and **Client ID** in the logs
3. Go to Neynar dashboard → find that client by ID
4. Verify **Allowed Origins** matches exactly (including `http://` or `https://`, no trailing slash)
5. If not, update in Neynar dashboard and wait 1-2 minutes for propagation

### Client ID not showing in console

**Cause**: Environment variable not set correctly.

**Fix**:
1. Check `.env.local` has the correct variable name:
   - `NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV` for localhost
   - `NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD` for production
2. Restart dev server: `npm run dev`
3. For Vercel, redeploy after setting env vars

### SIWN button doesn't appear

**Cause**: Neynar script not loading or client ID invalid.

**Fix**:
1. Check browser console for errors
2. Verify client ID is correct (copy from Neynar dashboard)
3. Clear browser cache and localStorage
4. Try in incognito/private window

## Admin FID Configuration

After SIWN is working, you need to add admin FIDs in the code:

Edit `components/admin/AdminAuthWrapper.tsx`:

```typescript
const ADMIN_FIDS = [
  6500,      // Primary admin
  1477413,   // Secondary admin
  // Add your FIDs here
]
```

Only users with FIDs in this list can access the analytics dashboard after signing in.

## Testing Checklist

- [ ] Dev client created in Neynar with `http://localhost:3000`
- [ ] Prod client created in Neynar with `https://lets-have-a-word.vercel.app`
- [ ] Both client IDs added to env vars
- [ ] Console logs show correct origin and client ID
- [ ] QR code appears when clicking "Sign in with Neynar"
- [ ] Farcaster app successfully scans QR and shows approval screen
- [ ] After approval, dashboard shows with user profile
- [ ] Admin FIDs configured correctly
