/* eslint arrow-body-style: 0 */

import gulp from 'gulp';

import { spawn, exec } from 'child_process';
import _ from 'lodash';
import babel from 'gulp-babel';
import clean from 'gulp-clean';
import concat from 'gulp-concat';
import cssmin from 'gulp-cssmin';
import { createWindowsInstaller as electronInstaller } from 'gpmdp-electron-winstaller';
import fs from 'fs';
import globber from 'glob';
import header from 'gulp-header';
import less from 'gulp-less';
import packager from 'electron-packager';
import nodePath from 'path';
import replace from 'gulp-replace';
import runSequence from 'run-sequence';
import electronWindowsStore from 'electron-windows-store';
// import uglify from 'gulp-uglify';
import rebuild from 'electron-rebuild';
import rasterImages from './vendor/svg_raster';

const paths = {
  internalScripts: ['src/**/*.js'],
  html: 'src/public_html/**/*.html',
  less: 'src/assets/less/**/*.less',
  fonts: ['node_modules/materialize-css/dist/fonts/**/*',
          '!node_modules/materialize-css/dist/font/material-design-icons/*',
          'node_modules/material-design-icons-iconfont/dist/fonts/**/*'],
  images: ['src/assets/img/**/*', 'src/assets/icons/*'],
  locales: ['src/_locales/*.json'],
};

const packageJSON = require('./package.json');

let version = packageJSON.devDependencies.electron;
if (version.substr(0, 1) !== '0' && version.substr(0, 1) !== '1' && version.substr(0, 1) !== '2' && version.substr(0, 1) !== '3') {
  version = version.substr(1);
}

const defaultPackageConf = {
  appBundleId: packageJSON.name,
  appCategoryType: 'public.app-category.music',
  appCopyright: `Copyright © ${(new Date()).getFullYear()} ${packageJSON.author.name}, All rights reserved.`, // eslint-disable-line
  appVersion: packageJSON.version,
  afterCopy: [
    (buildPath, electronVersion, pPlatform, pArch, done) => rebuild(buildPath, electronVersion, pArch).then(() => done()).catch(done),
    (buildPath, electronVersion, pPlatform, pArch, done) => {
      const files = globber.sync(nodePath.resolve(buildPath, '**', '*.pdb'))
        .concat(globber.sync(nodePath.resolve(buildPath, '**', '*.obj')))
        .concat(globber.sync(nodePath.resolve(buildPath, '**', '.bin', '**', '*')));
      files.forEach(filePath => fs.unlinkSync(filePath));
      done();
    },
  ],
  arch: 'all',
  tmpdir: '/tmp',
  asar: true,
  buildVersion: packageJSON.version,
  dir: __dirname,
  icon: './build/assets/img/main',
  ignore: (path) => {
    const tests = [
      // Ignore git directory
      () => /^\/\.git\/.*/g,
      // Ignore uwp directory
      () => /^\/\uwp\/.*/g,
      // Ignore electron-packager on Docker machines
      () => /^\/electron-packager\//g,
      // Ignore electron
      () => /^\/node_modules\/electron\//g,
      () => /^\/node_modules\/electron$/g,
      // Ignore debug files
      () => /^\/node_modules\/.*\.pdb/g,
      // Ignore native module obj files
      () => /^\/node_modules\/.*\.obj/g,
      // Ignore optional dev modules
      () => /^\/node_modules\/appdmg/g,
      () => /^\/node_modules\/electron-installer-debian/g,
      () => /^\/node_modules\/electron-installer-redhat/g,
      // Ignore symlinks in the bin directory
      () => /^\/node_modules\/.bin/g,
      // Ignore root dev FileDescription
      () => /^\/(vendor|dist|sig|docs|src|test|.cert.pfx|.editorconfig|.eslintignore|.eslintrc|.gitignore|.travis.yml|appveyor.yml|circle.yml|CONTRIBUTING.md|Gruntfile.js|gulpfile.js|ISSUE_TEMPLATE.md|LICENSE|README.md)(\/|$)/g, // eslint-disable-line
    ];
    for (let i = 0; i < tests.length; i++) {
      if (tests[i]().test(path)) {
        return true;
      }
    }
    return false;
  },
  name: packageJSON.productName,
  out: './dist/',
  overwrite: true,
  platform: 'all',
  prune: true,
  electronVersion: version,
  win32metadata: {
    CompanyName: packageJSON.author.name,
    FileDescription: packageJSON.productName,
    ProductName: packageJSON.productName,
    InternalName: packageJSON.productName,
  },
};

const winstallerConfig = {
  appDirectory: `dist/${packageJSON.productName}-win32-ia32`,
  outputDirectory: 'dist/installers/win32',
  authors: packageJSON.author.name,
  exe: `${packageJSON.productName}.exe`,
  description: packageJSON.productName,
  title: packageJSON.productName,
  owners: packageJSON.author.name,
  name: 'GPMDP_3',
  noMsi: true,
  certificateFile: '.cert.pfx',
  certificatePassword: process.env.SIGN_CERT_PASS,
  // DEV: When in master we should change this to point to github raw url
  iconUrl: 'https://www.samuelattard.com/img/gpmdp_setup.ico',
  setupIcon: 'build/assets/img/main.ico',
  loadingGif: 'build/assets/img/installing.gif',
};

if (!process.env.GPMDP_DONT_BUILD_DELTAS) {
  winstallerConfig.remoteReleases = 'https://github.com/MarshallOfSound/Google-Play-Music-Desktop-Player-UNOFFICIAL-';
}

if (process.env.APPVEYOR) {
  delete winstallerConfig.remoteReleases;
}

const appdmgConf = {
  target: `dist/${packageJSON.productName}-darwin-x64/${packageJSON.productName}.dmg`,
  basepath: __dirname,
  specification: {
    title: 'GPMDP',
    icon: `${defaultPackageConf.icon}.icns`,
    background: 'src/assets/img/dmg.png',
    window: {
      size: {
        width: 600,
        height: 400,
      },
    },
    contents: [
      {
        x: 490, y: 252, type: 'link', path: '/Applications',
      },
      {
        x: 106, y: 252, type: 'file', path: `dist/${packageJSON.productName}-darwin-x64/${packageJSON.productName}.app`,
      },
    ],
  },
};

const cleanGlob = (glob, allowSkip) => {
  if (allowSkip && process.env.GPMDP_SKIP_PACKAGE) return;
  return () => {
    return gulp.src(glob, { read: false })
      .pipe(clean({ force: true }));
  };
};

const windowsSignFile = (filePath, signDigest) =>
  new Promise((resolve) => {
    console.log(`Signing file: "${filePath}"\nWith digest: ${signDigest}`);
    exec(
      `vendor\\signtool sign /f ".cert.pfx" /p ${process.env.SIGN_CERT_PASS} /td ${signDigest} /fd ${signDigest} /tr "http://timestamp.digicert.com" /v /as "${filePath}"`,
      {},
      () => {
        setTimeout(() => {
          setTimeout(resolve, 500);
        });
      }
    );
  });

function handleError(err) {
  // Print the plugin that the error came from so that you don't
  // have to go searching through the error message to find it.
  if (err.plugin) {
    console.error(`Error in '${err.plugin}':`); // eslint-disable-line
  }

  console.error(err); // eslint-disable-line

  // We *must* emit 'end', otherwise, when watching, the task
  // will never repeat. Note that this function is not an
  // arrow function so that the correct `this` is used here.
  this.emit('end');
}

gulp.task('clean', cleanGlob(['./build', './dist']));
gulp.task('clean-dist-win', cleanGlob(`./dist/${packageJSON.productName}-win32-ia32`));
gulp.task('clean-dist-darwin', cleanGlob(`./dist/${packageJSON.productName}-darwin-ia32`));
gulp.task('clean-dist-linux-32', cleanGlob(`./dist/${packageJSON.productName}-linux-ia32`, true));
gulp.task('clean-dist-linux-64', cleanGlob(`./dist/${packageJSON.productName}-linux-x64`, true));
gulp.task('clean-html', cleanGlob('./build/public_html'));
gulp.task('clean-internal', cleanGlob(['./build/*.js', './build/**/*.js', '!./build/assets/**/*']));
gulp.task('clean-fonts', cleanGlob('./build/assets/fonts'));
gulp.task('clean-less', cleanGlob('./build/assets/css'));
gulp.task('clean-images', cleanGlob('./build/assets/img'));
gulp.task('clean-locales', cleanGlob('./build/_locales/*.json'));

gulp.task('html', ['clean-html'], () => {
  return gulp.src(paths.html)
    .pipe(gulp.dest('./build/public_html'));
});

gulp.task('transpile', ['clean-internal'], () => {
  return gulp.src(paths.internalScripts)
    .pipe(babel())
    .on('error', handleError)
    .pipe(replace(/process\.env\.([a-zA-Z_]+)?( |,|;|\))/gi, (envCall, envKey, closer) => {
      return `'${process.env[envKey]}'${closer}`;
    }))
    .pipe(gulp.dest('./build/'));
});

gulp.task('locales', ['clean-locales'], () => {
  return gulp.src(paths.locales)
    .pipe(gulp.dest('./build/_locales'));
});

gulp.task('fonts', ['clean-fonts'], () => {
  return gulp.src(paths.fonts)
    .pipe(gulp.dest('./build/assets/fonts'));
});

gulp.task('less', ['clean-less'], () => {
  return gulp.src(paths.less)
    .pipe(less())
    .on('error', handleError)
    .pipe(cssmin())
    .pipe(concat('core.css'))
    .pipe(gulp.dest('./build/assets/css'));
});

// Copy all static images
gulp.task('copy-static-images', ['clean-images'], () => {
  return gulp.src(paths.images)
    .pipe(gulp.dest('./build/assets/img/'));
});

gulp.task('images', ['copy-static-images'], (done) => {
  rasterImages(done);
});

gulp.task('build-release', ['build'], () => {
  return gulp.src('./build/**/*.js')
    // .pipe(uglify())
    .pipe(header(
`/*!
${packageJSON.productName}
Version: v${packageJSON.version}
API Version: v${packageJSON.apiVersion}
Compiled: ${new Date().toUTCString()}
Copyright (C) ${(new Date()).getFullYear()} ${packageJSON.author.name}
This software may be modified and distributed under the terms of the MIT license.
 */\n`
    ))
    .pipe(gulp.dest('./build'));
});

// Rerun the task when a file changes
gulp.task('watch', ['build'], () => {
  gulp.watch(paths.internalScripts, ['transpile']);
  gulp.watch(paths.html, ['html']);
  gulp.watch(paths.images, ['images']);
  gulp.watch(paths.less, ['less']);
  gulp.watch(paths.locales, ['locales']);
});

gulp.task('package:win', ['clean-dist-win', 'build-release'], (done) => {
  packager(_.extend({}, defaultPackageConf, { platform: 'win32', arch: 'ia32' })).then(() => {
    setTimeout(() => {
      const packageExePath = `dist/${packageJSON.productName}-win32-ia32/${packageJSON.productName}.exe`;
      windowsSignFile(packageExePath, 'sha1')
      .then(() => windowsSignFile(packageExePath, 'sha256'))
      .then(() => done());
    }, 1000);
  }).catch((err) => done(err));
});

gulp.task('make:win', ['package:win'], (done) => {
  electronInstaller(winstallerConfig)
    .then(() => {
      const installerExePath = `dist/installers/win32/${packageJSON.productName}Setup.exe`;
      windowsSignFile(installerExePath, 'sha1')
      .then(() => windowsSignFile(installerExePath, 'sha256'))
      .then(() => done());
    })
    .catch((err) => done(err));
});

gulp.task('make:win:uwp', ['package:win'], (done) => {
  electronWindowsStore({
    containerVirtualization: false,
    inputDirectory: nodePath.resolve(__dirname, `dist/${packageJSON.productName}-win32-ia32`),
    outputDirectory: nodePath.resolve(__dirname, 'dist/uwp'),
    flatten: true,
    packageVersion: `${packageJSON.version}.0`,
    packageName: 'GPMDP',
    packageDisplayName: 'GPMDP',
    packageDescription: packageJSON.description,
    packageExecutable: `app\\${packageJSON.productName}.exe`,
    publisher: 'CN=E800FCD7-1562-414E-A4AC-F1BA78F4A060',
    publisherDisplayName: 'Samuel Attard',
    assets: 'build\\assets\\img\\assets',
    devCert: nodePath.resolve(__dirname, '.uwp.pfx'),
    signtoolParams: ['/p', process.env.SIGN_CERT_PASS],
    finalSay: () => new Promise((resolve) => {
      const manifestPath = nodePath.resolve(__dirname, 'dist/uwp/pre-appx/appxmanifest.xml');
      const manifest = fs.readFileSync(manifestPath, 'utf8').replace('<Identity Name="GPMDP"', '<Identity Name="24619SamuelAttard.GPMDP"');
      fs.writeFileSync(manifestPath, manifest);
      resolve();
    }),
  }).then(() => done()).catch(done);
});

gulp.task('package:darwin', ['clean-dist-darwin', 'build-release'], (done) => {
  packager(_.extend({}, defaultPackageConf, { platform: 'darwin', osxSign: { identity: 'Developer ID Application: Samuel Attard (S7WPQ45ZU2)' } })) // eslint-disable-line
    .then(() => done())
    .catch((err) => done(err));
});

gulp.task('make:darwin', ['package:darwin'], (done) => {
  const pathEscapedName = packageJSON.productName.replace(/ /gi, ' ');
  const child = spawn('zip', ['-r', '-y', `${pathEscapedName}.zip`, `${pathEscapedName}.app`],
    {
      cwd: `./dist/${packageJSON.productName}-darwin-x64`,
    });

  console.log(`Zipping "${packageJSON.productName}.app"`); // eslint-disable-line

  child.stdout.on('data', () => {});

  child.stderr.on('data', () => {});

  child.on('close', (code) => {
    console.log('Finished zipping with code ' + code); // eslint-disable-line

    done();
  });
});

gulp.task('dmg:darwin', ['package:darwin'], (done) => {
  if (fs.existsSync(nodePath.resolve(__dirname, appdmgConf.target))) {
    fs.unlinkSync(nodePath.resolve(__dirname, appdmgConf.target));
  }
  const dmg = require('appdmg')(appdmgConf);

  dmg.on('finish', () => done());
  dmg.on('error', done);
});

gulp.task('package:linux:32', ['clean-dist-linux-32', 'build-release'], (done) => {
  if (process.env.GPMDP_SKIP_PACKAGE) return done();
  packager(_.extend({}, defaultPackageConf, { platform: 'linux', arch: 'ia32' }))
    .then(() => done())
    .catch((err) => done(err));
});

gulp.task('package:linux:64', ['clean-dist-linux-64', 'build-release'], (done) => {
  if (process.env.GPMDP_SKIP_PACKAGE) return done();
  packager(_.extend({}, defaultPackageConf, { platform: 'linux', arch: 'x64' }))
    .then(() => done())
    .catch((err) => done(err));
});

gulp.task('package:linux', (done) => {
  runSequence('package:linux:32', 'package:linux:64', done);
});

const generateGulpLinuxDistroTask = (prefix, name, arch) => {
  gulp.task(`${prefix}:linux:${arch}`, [`package:linux:${arch}`], (done) => {
    const tool = require(`electron-installer-${name}`);

    const defaults = {
      bin: packageJSON.productName,
      dest: `dist/installers/${name}`,
      depends: ['libappindicator1', 'avahi-daemon'],
      maintainer: `${packageJSON.author.name} <${packageJSON.author.email}>`,
      homepage: packageJSON.homepage,
      icon: 'build/assets/img/main.png',
      categories: ['AudioVideo', 'Audio'],
      section: 'sound',
    };

    let pkgArch = 'i386';
    if (arch === '64') {
      pkgArch = (prefix === 'rpm' ? 'x86_64' : 'amd64');
    }

    tool(_.extend({}, defaults, {
      src: `dist/${packageJSON.productName}-linux-${arch === '32' ? 'ia32' : 'x64'}`,
      arch: pkgArch,
    }), (err) => {
      console.log(`${arch}bit ${prefix} package built`); // eslint-disable-line
      if (err) return done(err);
      done();
    });
  });
};

generateGulpLinuxDistroTask('rpm', 'redhat', '32');
generateGulpLinuxDistroTask('rpm', 'redhat', '64');
generateGulpLinuxDistroTask('deb', 'debian', '32');
generateGulpLinuxDistroTask('deb', 'debian', '64');

gulp.task('rpm:linux', (done) => {
  runSequence('rpm:linux:32', 'rpm:linux:64', done);
});

gulp.task('deb:linux', (done) => {
  runSequence('deb:linux:32', 'deb:linux:64', done);
});

const zipTask = (makeName, deps, cwd, what) => {
  gulp.task(`make:${makeName}`, deps, (done) => {
    const child = spawn('zip', ['-r', '-y', 'installers.zip', '.'], { cwd });

    console.log(`Zipping ${what}`); // eslint-disable-line

    // spit stdout to screen
    child.stdout.on('data', () => {});

    // Send stderr to the main console
    child.stderr.on('data', () => {});

    child.on('close', (code) => {
      console.log(`Finished zipping ${what} with code: ${code}`); // eslint-disable-line
      done();
    });
  });
};

gulp.task('make:linux', (done) => {
  runSequence('deb:linux', 'rpm:linux', 'make:linux:both', done);
});

zipTask('linux:both', [], './dist/installers', 'all the Linux Installers');
zipTask('linux:deb', ['deb:linux'], './dist/installers/debian', 'the Debian Packages');
zipTask('linux:rpm', ['rpm:linux'], './dist/installers/redhat', 'the Redhat (Fedora) Packages');

// The default task (called when you run `gulp` from cli)
gulp.task('default', ['watch', 'transpile', 'images']);
gulp.task('build', ['transpile', 'images', 'less', 'fonts', 'html', 'locales']);
gulp.task('package', ['package:win', 'package:darwin', 'package:linux']);
