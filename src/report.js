'use strict'

require('colors')
const join = require('path').join
const exec = require('child_process').exec
const open = require('opn')
const mkdirp = require('mkdirp')
const fs = require('fs')
const argv = require('yargs').argv
const mapSeries = require('async/mapSeries')
const waterfall = require('async/waterfall')
const parallel = require('async/parallel')

let suites = argv._
if (!suites.length) {
  suites = require('./suites').map(s => s.name)
}

const prefix = (new Date()).toISOString() + '-report'
const outDir = join(__dirname, '..', 'reports', 'out', prefix)
mkdirp.sync(outDir)
const out = join(outDir, 'report.html')
const resultsJSONPath = join(outDir, 'results.json')

mapSeries(
  suites,
  (suite, callback) => {
    waterfall([
      (callback) => {
        // run suite
        const command = 'node ' + __dirname + ' ' + suite
        const child = exec(command, (err, stdout) => {
          console.log(stdout)
          if (err) {
            callback(err)
          } else {
            const out = cleanOutput(stdout)
            try {
              callback(null, JSON.parse(out))
            } catch (err) {
              console.error('Error parsing output: %s' + out)
              throw err
            }
          }
        })
        child.stderr.pipe(process.stderr, { end: false })
      },
      (result, callback) => {
        // profile suite (if --profile option was given)
        if (!argv.profile) {
          callback(null, result)
          return
        }
        process.stderr.write(('profiling ' + suite + '\n').yellow)
        const command = ['node', join(__dirname, 'profile'), suite, '--out', join(outDir, suite)].join(' ')
        const child = exec(command, (err, stdout) => {
          if (err) {
            callback(err)
          } else {
            process.stderr.write('done\n\n'.green)
            result[0].profile = join(suite, stdout.trim())
            callback(null, result)
          }
        })
        child.stderr.pipe(process.stderr, { end: false })
      }
      ],
      callback)
  },
  (err, _results) => {
    if (err) {
      throw err
    }

    const results = _results.reduce((acc, a) => acc.concat(a), [])

    parallel([
      (callback) => saveResults(results, callback),
      (callback) => generateReport(results, callback),
      ],
      (err) => {
        if (err) {
          throw err
        }
        process.stderr.write('finished.\n'.green)
        process.stderr.write('saved results to ' + resultsJSONPath + '\n')
        process.stderr.write('opening ' + out + '\n')
        open(out, { wait: false })
      })
  }
)

function saveResults (results, callback) {
  const out = resultsJSONPath
  fs.writeFile(out, JSON.stringify(results, null, '  '), callback)
}

function generateReport (results, callback) {
  process.stderr.write('generating report...\n'.yellow)
  const command = 'node src/generate-report > ' + out

  const child = exec(command, callback)
  child.stderr.pipe(process.stderr, { end: false })
  child.stdin.end(JSON.stringify(results))
}

function cleanOutput (out) {
  const patternsToObliterate = [
    /Swarm listening on .*\n/g,
    /Starting at .*\n/g,
    /API is listening on: .*\n/g,
    /Gateway \(readonly\) is listening on: .*\n/g,
    /Stopping server/g
  ]

  return patternsToObliterate.reduce((out, p) => out.replace(p, ''), out)
}