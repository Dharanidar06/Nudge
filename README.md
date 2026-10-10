# Nudge for Android

Nudge is a real Android application packaged around a small offline web interface. The app uses Android alarms and notifications, so reminders are scheduled by Android rather than depending on an open browser tab. **A GitHub Actions workflow builds the APK for you; your computer does not need Android Studio or the Android SDK.**

## Reminder features

- Create, edit, enable, disable, and delete reminders.
- Set a daily start and finish time and a repeat interval.
- Choose the girl or boy character and write a personal message.
- Tap a reminder notification to open the screen where your character slides in.
- Watch the character raise the water bottle for water-related reminders.
- Keep reminder data locally on the phone and restore alarms after a restart.
- Allow exact alarms for more accurate delivery. Otherwise, Android can delay alarms while the phone is idle.

For example, **9:00 AM–4:00 PM every 3 hours** triggers at **9:00 AM, noon, and 3:00 PM**.

## Build the APK in GitHub without Android Studio or an Android SDK

The APK is built on GitHub-hosted runners, not on your computer. You will need a GitHub account.

1. On GitHub, create an **empty private repository** named `nudge`. Do not add a README, license, or `.gitignore` to it.
2. Open this project folder in VS Code. In its integrated PowerShell terminal, upload the project to your private repository. Replace `YOUR-USERNAME` with your GitHub username:

   ```powershell
   git init -b main
   git add .
   git commit -m "Build Nudge Android app"
   git remote add origin https://github.com/YOUR-USERNAME/nudge.git
   git push -u origin main
   ```

   Sign in through GitHub's prompts if requested. Keep the repository private: uploading your code to GitHub gives GitHub's build service access to it.
3. In the GitHub repository, open **Actions**, select **Build Nudge APK**, and wait for the run to finish successfully. Uploading the `main` branch starts the build automatically.
4. Open the successful run, scroll to **Artifacts**, and download **nudge-android-apk**. GitHub downloads the APK inside a ZIP file; it does not commit the APK or the Android SDK to your computer.
5. On your Android phone, download the ZIP from your private repository, extract `app-debug.apk`, and tap it. If Android prompts you, allow your browser or Files app to **install unknown apps**, then confirm **Install**. You may need to be signed in to GitHub on your phone to access the private build.
6. Open **Nudge** and allow notifications. To make reminders more punctual, use the in-app **Allow** button to enable exact alarms in Android settings.

You can run the same build again from **Actions → Build Nudge APK → Run workflow**. Workflow downloads are kept for 90 days. The workflow outputs a sideloadable debug APK; it is intended for personal use and is not a Play Store release. Every GitHub runner creates its own debug signing key, so a later APK may not install as an in-place update over an earlier download. Back up any important reminder details before replacing the app.

## Run the browser preview from VS Code

The existing web preview remains available. To run it from the integrated PowerShell terminal:

```powershell
py -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). **The Android app and its background reminder alarms are built by GitHub Actions; serving this preview alone does not produce an APK.**

## Important Android behavior

Android controls notification and exact-alarm permissions. Denied notifications prevent reminders from appearing. If exact alarms are not allowed, Android may deliver reminders later during idle or power-saving modes. Nudge does not show a character over other apps: tapping its notification opens Nudge's animated reminder screen.
