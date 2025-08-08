# Code Signing Setup for Screenshot Manager

This document explains how to set up code signing for the Screenshot Manager app using your Apple Developer account.

## Required GitHub Secrets

You need to add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

### 1. APPLE_CERTIFICATE
- **Description**: Base64-encoded .p12 certificate file
- **How to get it**:
  1. **Create Certificate Signing Request (CSR)**:
     - Open Keychain Access on your Mac
     - Go to Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority
     - Enter your email and common name (your name)
     - Select "Saved to disk" and "Let me specify key pair information"
     - Save the CSR file to your desktop
  2. **Create Developer ID Certificate**:
     - Go to [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list)
     - Click "+" to create a new certificate
     - Select "Developer ID Application" under "Distribution" (NOT "Apple Development")
     - Upload the CSR file you created
     - Download the certificate (.cer file)
     - **Important**: Use "Developer ID Application" for apps distributed outside the Mac App Store
  3. **Export as .p12**:
     - Double-click the .cer file to import into Keychain Access
     - In Keychain Access, find your certificate under "My Certificates"
     - Right-click → Export → Personal Information Exchange (.p12)
     - Set a strong password when prompted
  4. **Convert to base64**: `base64 -i certificate.p12 | pbcopy`

### 2. APPLE_CERTIFICATE_PASSWORD
- **Description**: Password used when exporting the .p12 certificate
- **How to get it**: The password you set when exporting the certificate from Keychain Access

### 3. APPLE_SIGNING_IDENTITY
- **Description**: The signing identity name
- **How to get it**: Usually in format "Developer ID Application: Your Name (TEAM_ID)"
- **Example**: "Developer ID Application: John Doe (ABC123DEF4)"

### 4. APPLE_ID
- **Description**: Your Apple ID email address
- **How to get it**: The email address associated with your Apple Developer account

### 5. APPLE_PASSWORD
- **Description**: App-specific password for your Apple ID
- **How to get it**:
  1. Go to [Apple ID account page](https://appleid.apple.com)
  2. Sign in with your Apple ID
  3. Go to "App-Specific Passwords" section
  4. Generate a new app-specific password for "Xcode"

### 6. APPLE_TEAM_ID
- **Description**: Your Apple Developer Team ID
- **How to get it**: Found in your [Apple Developer account](https://developer.apple.com/account/resources/certificates/list) (usually 10 characters)

## Configuration Files

The following files have been configured for code signing:

### src-tauri/tauri.conf.json
- Added `macOS` bundle configuration with:
  - `hardenedRuntime: true` - Required for notarization
  - `signingIdentity: null` - Will use environment variable
  - `entitlements: null` - Uses default entitlements

### .github/workflows/build-mac.yml
- Added certificate import step using `Apple-Actions/import-codesign-certs@v3`
- Added environment variables for signing during build
- Conditional execution - only runs if certificates are available

## Testing

1. Add all the required secrets to your GitHub repository
2. Push changes or create a new tag to trigger the build
3. The workflow will automatically sign the app if certificates are present
4. Check the build logs to verify signing was successful
5. The signed DMG will be uploaded as an artifact and included in releases

## Troubleshooting

- **"failed to resolve signing identity"**: 
  - Ensure you created a "Developer ID Application" certificate (not "Apple Development")
  - Verify `APPLE_SIGNING_IDENTITY` matches exactly (format: "Developer ID Application: Your Name (TEAM_ID)")
  - Check that the certificate was properly imported into the GitHub Actions keychain
- **Certificate not found**: Verify `APPLE_SIGNING_IDENTITY` matches the certificate name exactly
- **Notarization fails**: Ensure `APPLE_ID` and `APPLE_PASSWORD` are correct app-specific password
- **Build fails**: Check that `APPLE_TEAM_ID` matches your developer account (10-character string)

## Certificate Types
- **Apple Development**: For development/testing only, won't work for distribution
- **Developer ID Application**: Required for apps distributed outside Mac App Store (use this one)

## Benefits of Code Signing

- **Gatekeeper Compatibility**: Signed apps can run without security warnings
- **User Trust**: Users see your verified developer identity  
- **App Store Distribution**: Required for Mac App Store submission
- **Notarization Ready**: Enables Apple's notarization service for additional security validation