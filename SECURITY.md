# Security policy

## Supported versions

Security fixes go into the latest 1.x release of `@01x/dicom-viewer-core`, `@01x/dicom-viewer-elements`, `@01x/dicom-viewer-react`, and `@01x/dicom-viewer-vue`. The four packages share one version.

## Report a vulnerability

Use GitHub's private report: open the repository's **Security** tab and choose **Report a vulnerability** (https://github.com/01x-in/dicom-viewer/security/advisories/new). Do not open a public issue for a vulnerability.

Say which package and version you used, what you did, what you expected, and what happened. A small page or a test that shows the problem is the most useful thing you can send.

**Do not send patient data.** Use the synthetic phantom in `fixtures/phantom`, or make a file by hand.

We aim to answer within a few days and to tell you what we decide. When the fix is released, we credit you in the release notes if you want that.

## What is in scope

- A way to make the viewer run script, or to show markup, from DICOM data, a config, or a link.
- A way to make the viewer send a request to a place that the host did not choose, or send a credential to the wrong place.
- A way to show a tag that identifies a patient when `showPatientInfo` is off.
- A weakness in how the packages are built or published.

## What is not in scope

The package has no login and no access control: the host project decides who may see what, and its server must check it. A report that a user of the page can see data the server gave them is not a vulnerability in the viewer. See [Servers, security, and errors](README.md#servers-security-and-errors).
