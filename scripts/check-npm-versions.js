const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

function extractVersion (spec) {
    if (!spec) return null
    const m = spec.match(/(\d+\.\d+\.\d+)/)
    return m ? m[1] : null
}

function majorOf (ver) {
    if (!ver) return null
    return parseInt(ver.split('.')[0], 10)
}

async function checkPackages (list) {
    const rows = []
    for (const name of Object.keys(list)) {
        const currentSpec = list[name]
        let versions = null
        try {
            const out = execSync(`npm view ${name} versions --json`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
            versions = JSON.parse(out)
        } catch (_e) {
            try {
                const latest = execSync(`npm view ${name} version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
                versions = [latest]
            } catch (_e2) {
                versions = []
            }
        }
        const latestOverall = versions.length ? versions[versions.length - 1] : 'N/A'
        const baseVer = extractVersion(currentSpec)
        const baseMajor = majorOf(baseVer)
        let latestSameMajor = 'N/A'
        if (baseMajor != null && versions.length) {
            for (let i = versions.length - 1; i >= 0; i--) {
                const v = versions[i]
                const m = majorOf(v)
                if (m === baseMajor) { latestSameMajor = v; break }
            }
            if (latestSameMajor === 'N/A') latestSameMajor = 'None on same major'
        }
        rows.push({ name, currentSpec, latestSameMajor, latestOverall })
    }
    return rows
}

(async function main () {
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {})
    if (!Object.keys(deps).length) {
        console.info('No dependencies found in package.json')
        return
    }
    console.info('| dep | current | latest on stream | latest |')
    console.info('|---|---:|---:|---:|')
    const rows = await checkPackages(deps)
    for (const r of rows) {
        console.info(`| ${r.name} | ${r.currentSpec} | ${r.latestSameMajor} | ${r.latestOverall} |`)
    }
})()
