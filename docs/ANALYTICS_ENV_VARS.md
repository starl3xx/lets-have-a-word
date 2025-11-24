# Analytics Environment Variables

These environment variables must be set in your Vercel production deployment for the analytics dashboard to work.

## Required Variables

### ANALYTICS_ENABLED
**Description**: Enables the analytics API endpoints
**Value**: `true`
**Example**: `ANALYTICS_ENABLED=true`

**What happens if not set**: API will return 503 error: "Analytics not enabled. Set ANALYTICS_ENABLED=true in environment variables."

### LHAW_ADMIN_USER_IDS
**Description**: Comma-separated list of Farcaster FIDs that have admin access
**Value**: `6500,1477413` (or your admin FIDs)
**Example**: `LHAW_ADMIN_USER_IDS=6500,1477413`

**What happens if not set**: API will return 403 error: "Forbidden: FID {fid} is not an admin. Set LHAW_ADMIN_USER_IDS environment variable."

### NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV
**Description**: Neynar SIWN client ID for localhost
**Value**: Your dev client ID from Neynar dashboard
**Example**: `NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV=abc123...`

**Required for**: Local development

### NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD
**Description**: Neynar SIWN client ID for production
**Value**: Your prod client ID from Neynar dashboard
**Example**: `NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD=xyz789...`

**Required for**: Production deployment

## Setting in Vercel

1. Go to your project in Vercel dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable with its value
4. Select **Production** environment
5. Click **Save**
6. Redeploy your application

## Verifying Setup

After deployment, visit `/admin/analytics` and check:

1. **Browser console** - Should show Neynar configuration (client ID, origin)
2. **Sign in with Neynar** - Should work without "client config" errors
3. **After sign-in** - Dashboard should load or show specific error messages:
   - ✅ "Loading..." → Data loads successfully
   - ❌ "Analytics not enabled..." → Set `ANALYTICS_ENABLED=true`
   - ❌ "Forbidden: FID X is not an admin..." → Add your FID to `LHAW_ADMIN_USER_IDS`
   - ❌ "Authentication required..." → SIWN not working properly
   - ❌ "Internal server error" → Check database connection or Vercel logs

## Troubleshooting

### Empty data (no users yet)
If the analytics views are empty because there are no users yet, the dashboard will show zeros (0) for all metrics. This is normal and NOT an error.

### Error messages
The dashboard now shows specific error messages to help debug configuration issues. Read the error message carefully and set the appropriate environment variable.

### Vercel logs
Check your Vercel deployment logs for console output from the API routes. Look for lines starting with `[analytics/dau]` or `[analytics/free-paid]`.
