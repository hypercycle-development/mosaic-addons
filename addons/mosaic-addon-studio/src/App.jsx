import { useEffect, useMemo, useState } from 'react'
import {
  Blocks, LayoutDashboard, Puzzle, ShieldCheck, Settings,
  FolderPlus, FileCode2, Copy, Check, AlertTriangle,
  Activity, ArrowUpRight, Terminal, Sparkles, ChevronRight,
  CircleHelp, RefreshCw, Code2, LockKeyhole, Rocket,
  Menu, X, Clock3, Server, BadgeCheck, FolderOpen, Search
} from 'lucide-react'
import './App.css'

import {
  ID_PATTERN,
  deriveIpcNamespace,
} from '../shared/mosaic-schema.mjs'
import { createHost } from './host.js'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'builder', label: 'Add-on Builder', icon: Puzzle },
  { id: 'validator', label: 'Validator', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export default function App() {
  // The host decides where projects live: a local service on disk, or the
  // add-on's own data jail inside Mosaic. The rules are identical either
  // way; only the storage differs.
  const host = useMemo(() => createHost(), [])
  const [activeView, setActiveView] = useState('dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [name, setName] = useState('My Add-on')
  const [id, setId] = useState('my-addon')
  const [description, setDescription] = useState('A starter add-on for Mosaic Companion.')
  const [license, setLicense] = useState('MIT')
  const [author, setAuthor] = useState('')
  const [homepage, setHomepage] = useState('')
  const [minAppVersion, setMinAppVersion] = useState('')
  const [apiStatus, setApiStatus] = useState('checking')
  const [hostDetail, setHostDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [copied, setCopied] = useState(false)
  const [lastAction, setLastAction] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectsReload, setProjectsReload] = useState(0)

  const validId = ID_PATTERN.test(id.trim())
  const validName = name.trim().length > 0 && name.trim().length <= 40
  const validDescription = description.trim().length > 0 && description.trim().length <= 200

  const namespace = deriveIpcNamespace(id.trim())

  const manifest = useMemo(() => ({
    manifestVersion: 1,
    id: id.trim(),
    name: name.trim(),
    version: '0.1.0',
    description: description.trim(),
    ...(author.trim() ? { author: author.trim() } : {}),
    ...(homepage.trim() ? { homepage: homepage.trim() } : {}),
    ...(minAppVersion.trim() ? { minAppVersion: minAppVersion.trim() } : {}),
    ipcNamespace: namespace,
    mountPoint: 'tab',
    tab: {
      label: name.trim().slice(0, 24),
      icon: 'Sparkles',
      order: 100
    },
    renderer: {
      entry: 'renderer/index.html'
    },
    permissions: [],
    updates: {
      checkMode: 'manual'
    },
    linkVisibilityToActivation: true,
    buckets: {
      publishes: [],
      reads: []
    }
  }), [id, name, description, namespace, author, homepage, minAppVersion])

  useEffect(() => {
    let active = true

    async function checkApi() {
      try {
        const health = await host.health()
        if (!health.ok) throw new Error('Host unavailable')
        if (active) {
          setApiStatus('online')
          setHostDetail(health.detail || '')
        }
      } catch {
        if (active) setApiStatus('offline')
      }
    }

    checkApi()
    const interval = window.setInterval(checkApi, 10000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [host])

  async function sendRequest(operation, payload, action) {
    setBusy(true)
    setNotice(null)

    try {
      const data = await operation(payload)

      const isInvalid = data.valid === false
      setNotice({
        type: isInvalid ? 'warning' : 'success',
        title: isInvalid ? 'Validation completed — issues found' : action,
        data
      })
      setLastAction({
        label: action,
        time: new Date().toLocaleTimeString()
      })
      setActiveView(operation === host.validateProject ? 'validator' : 'builder')
    } catch (error) {
      setNotice({
        type: 'error',
        title: error.message || 'The request failed.',
        data: null
      })
    } finally {
      setBusy(false)
    }
  }

  function createAddon() {
    if (!validName) {
      setNotice({ type: 'error', title: 'Name must contain between 1 and 40 characters.', data: null })
      return
    }
    if (!validId) {
      setNotice({ type: 'error', title: 'Use an ID starting with a lowercase letter, followed by lowercase letters, numbers or hyphens (2–41 characters).', data: null })
      return
    }
    if (!validDescription) {
      setNotice({ type: 'error', title: 'Description must contain between 1 and 200 characters.', data: null })
      return
    }

    sendRequest(host.createProject, {
      name: name.trim(),
      id: id.trim(),
      description: description.trim(),
      license,
      author: author.trim(),
      homepage: homepage.trim(),
      minAppVersion: minAppVersion.trim()
    }, 'Add-on project created successfully')
  }

  function validateAddon() {
    if (!validId) {
      setNotice({ type: 'error', title: 'Enter a valid add-on ID before validation.', data: null })
      return
    }
    sendRequest(host.validateProject, { id: id.trim() }, 'Validation completed successfully')
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice({
        type: 'error',
        title: 'Clipboard access failed. Please copy the text manually.',
        data: { text }
      })
    }
  }

  const jsonText = JSON.stringify(manifest, null, 2)
  const validation = notice?.data
  const validationErrors = validation?.errors || []
  const validationWarnings = validation?.warnings || []
  const validationChecks = validation?.checks || []


  useEffect(() => {
    if (activeView !== 'projects') return

    let active = true

    async function loadProjects() {
      setProjectsLoading(true)
      setProjectsError('')

      try {
        const list = await host.listProjects()
        if (!Array.isArray(list)) {
          throw new Error('The host returned an unexpected project list.')
        }

        if (active) {
          setProjects(list)
          setSelectedProject(current =>
            list.find(project => project.folder === current?.folder) || null
          )
        }
      } catch (error) {
        if (active) setProjectsError(error.message || 'Project loading failed.')
      } finally {
        if (active) setProjectsLoading(false)
      }
    }

    loadProjects()

    return () => {
      active = false
    }
  }, [activeView, projectsReload, host])

  const filteredProjects = projects.filter(project => {
    const query = projectQuery.trim().toLowerCase()
    const matchesQuery = !query ||
      [project.name, project.id, project.folder]
        .some(value => String(value || '').toLowerCase().includes(query))

    const matchesFilter =
      projectFilter === 'all' ||
      (projectFilter === 'valid' && project.manifestStatus === 'valid') ||
      (projectFilter === 'invalid' && project.manifestStatus !== 'valid') ||
      (projectFilter === 'incomplete' &&
        (!project.renderer || !project.readme || !project.license))

    return matchesQuery && matchesFilter
  })

  const validProjectCount = projects.filter(
    project => project.manifestStatus === 'valid'
  ).length

  const invalidProjectCount = projects.length - validProjectCount
  function navigate(view) {
    setActiveView(view)
    setMobileMenu(false)
  }

  const statusPill = (
    <div className={`api-pill ${apiStatus}`}>
      <span className="status-dot" />
      {apiStatus === 'online'
        ? (host.host === 'mosaic' ? 'Mosaic Connected' : 'API Connected')
        : apiStatus === 'offline'
          ? (host.host === 'mosaic' ? 'Mosaic Unavailable' : 'API Offline')
          : 'Connecting...'}
    </div>
  )

  const sidebarContent = (
      <>
        <div className="sidebar-brand">
          <div className="brand-mark"><Blocks size={23} /></div>
          <div className="brand-copy">
            <strong>MOSAIC<span>STUDIO</span></strong>
            <small>ADD-ON DEVELOPMENT</small>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="side-nav">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {activeView === item.id && <ChevronRight size={15} className="nav-arrow" />}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon"><CircleHelp size={18} /></div>
            <strong>Need a hand?</strong>
            <p>Build your first Mosaic add-on with confidence.</p>
            <button onClick={() => navigate('settings')}>View guidance <ArrowUpRight size={13} /></button>
          </div>
          <div className="sidebar-version">
            <span className="version-dot" />
            {host.host === 'mosaic' ? 'Inside Mosaic' : 'Local environment'}
            <span>v0.1</span>
          </div>
        </div>
      </>
  )

  return (
    <div className="studio-shell">
      <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}>
        {sidebarContent}
      </aside>

      {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="Close menu" />}

      <div className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">
            {mobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{NAV_ITEMS.find(item => item.id === activeView)?.label || 'Dashboard'}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment-label"><span /> {host.host === 'mosaic' ? 'MOSAIC COMPANION' : 'LOCAL ENVIRONMENT'}</span>
            {statusPill}
          </div>
        </header>

        <main className="page-content">
          {activeView === 'dashboard' && (
            <>
              <section className="welcome-banner">
                <div className="welcome-copy">
                  <div className="eyebrow"><Sparkles size={14} /> YOUR DEVELOPMENT WORKSPACE</div>
                  <h1>Build something<br /><span>remarkable.</span></h1>
                  <p>Create, configure and validate Mosaic Companion add-ons in one focused workspace.</p>
                  <button className="welcome-button" onClick={() => navigate('builder')}>
                    <FolderPlus size={17} /> Create an add-on <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-orbit orbit-one" />
                  <div className="art-orbit orbit-two" />
                  <div className="art-core"><Blocks size={54} /></div>
                  <div className="art-chip chip-one"><Code2 size={18} /></div>
                  <div className="art-chip chip-two"><ShieldCheck size={18} /></div>
                  <div className="art-chip chip-three"><Puzzle size={18} /></div>
                </div>
                <div className="banner-glow" />
              </section>

              <div className="section-heading">
                <div>
                  <span className="section-kicker">OVERVIEW</span>
                  <h2>Your workspace</h2>
                </div>
                <span className="muted-caption">Everything you need to get started</span>
              </div>

              <section className="overview-grid">
                <button className="overview-card" onClick={() => navigate('builder')}>
                  <div className="overview-icon purple"><Puzzle size={20} /></div>
                  <span className="card-overline">GET STARTED</span>
                  <strong>Build an add-on</strong>
                  <p>Set up your project details and generate a starter structure.</p>
                  <span className="card-link">Open builder <ArrowUpRight size={14} /></span>
                </button>
                <button className="overview-card" onClick={() => navigate('validator')}>
                  <div className="overview-icon green"><ShieldCheck size={20} /></div>
                  <span className="card-overline">QUALITY CHECK</span>
                  <strong>Validate a project</strong>
                  <p>Review manifest, license and package configuration.</p>
                  <span className="card-link">Open validator <ArrowUpRight size={14} /></span>
                </button>
                <button className="overview-card" onClick={() => navigate('settings')}>
                  <div className="overview-icon blue"><Terminal size={20} /></div>
                  <span className="card-overline">DEVELOPER INFO</span>
                  <strong>Studio guidance</strong>
                  <p>Understand the local workflow and project requirements.</p>
                  <span className="card-link">Explore guidance <ArrowUpRight size={14} /></span>
                </button>
              </section>

              <div className="dashboard-lower">
                <section className="content-card environment-card">
                  <div className="card-heading">
                    <div className="heading-icon"><Activity size={18} /></div>
                    <div><h3>Environment status</h3><p>{host.host === 'mosaic' ? 'Running as an add-on inside Mosaic' : 'Live connection to your local services'}</p></div>
                  </div>
                  <div className="environment-row">
                    <div className="environment-service"><Server size={17} /><span>{host.host === 'mosaic' ? 'Mosaic Companion' : 'Studio API'}</span></div>
                    <span className={`service-state ${apiStatus}`}>{apiStatus === 'online' ? (hostDetail || 'Operational') : apiStatus === 'offline' ? 'Unavailable' : 'Checking'}</span>
                  </div>
                  <div className="environment-row">
                    <div className="environment-service"><LockKeyhole size={17} /><span>Local-first workflow</span></div>
                    <span className="service-state operational">Enabled</span>
                  </div>
                  <div className="environment-row">
                    <div className="environment-service"><Clock3 size={17} /><span>Last activity</span></div>
                    <span className="service-state neutral">{lastAction?.time || 'No activity yet'}</span>
                  </div>
                </section>

                <section className="content-card quickstart-card">
                  <div className="card-heading">
                    <div className="heading-icon violet"><Rocket size={18} /></div>
                    <div><h3>Getting started</h3><p>Your path from idea to add-on</p></div>
                  </div>
                  <div className="quick-step"><span>01</span><div><strong>Configure</strong><small>Give your add-on an identity</small></div><Check size={16} /></div>
                  <div className="quick-step"><span>02</span><div><strong>Generate</strong><small>Create your starter project</small></div><ChevronRight size={16} /></div>
                  <div className="quick-step"><span>03</span><div><strong>Validate</strong><small>Review issues before submission</small></div><ChevronRight size={16} /></div>
                </section>
              </div>
            </>
          )}

          {activeView === 'projects' && (
            <section className="projects-page">
              <div className="section-heading projects-heading">
                <div>
                  <span className="section-kicker">WORKSPACE LIBRARY</span>
                  <h2>Your projects</h2>
                  <p className="muted-caption">
                    Browse and inspect your locally generated Mosaic add-ons.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setProjectsReload(value => value + 1)}
                  disabled={projectsLoading}
                >
                  <RefreshCw size={16} />
                  {projectsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <div className="project-stats">
                <div className="project-stat-card">
                  <span>Total projects</span>
                  <strong>{projects.length}</strong>
                  <small>Local project folders</small>
                </div>
                <div className="project-stat-card">
                  <span>Valid manifests</span>
                  <strong className="project-stat-good">{validProjectCount}</strong>
                  <small>Manifest structure accepted by local checks</small>
                </div>
                <div className="project-stat-card">
                  <span>Needs attention</span>
                  <strong className="project-stat-warning">
                    {invalidProjectCount}
                  </strong>
                  <small>Invalid manifests</small>
                </div>
              </div>

              <div className="project-browser">
                <div className="project-toolbar">
                  <label className="project-search">
                    <Search size={17} />
                    <input
                      type="search"
                      placeholder="Search by name, ID or folder..."
                      value={projectQuery}
                      onChange={event => setProjectQuery(event.target.value)}
                    />
                  </label>

                  <select
                    className="project-filter"
                    value={projectFilter}
                    onChange={event => setProjectFilter(event.target.value)}
                    aria-label="Filter projects"
                  >
                    <option value="all">All projects</option>
                    <option value="valid">Valid manifests</option>
                    <option value="invalid">Invalid manifests</option>
                    <option value="incomplete">Missing files</option>
                  </select>
                </div>

                {projectsError && (
                  <div className="project-error">
                    <AlertTriangle size={18} />
                    <span>{projectsError}</span>
                    <button onClick={() => setProjectsReload(value => value + 1)}>
                      Try again
                    </button>
                  </div>
                )}

                {projectsLoading && projects.length === 0 && (
                  <div className="project-empty">Loading your projects...</div>
                )}

                {!projectsLoading && !projectsError && filteredProjects.length === 0 && (
                  <div className="project-empty">
                    No projects match your search or filter.
                  </div>
                )}

                <div className="project-layout">
                  <div className="project-list">
                    {filteredProjects.map(project => (
                      <button
                        key={project.folder}
                        className={`project-list-item ${
                          selectedProject?.folder === project.folder ? 'selected' : ''
                        }`}
                        onClick={() => setSelectedProject(project)}
                      >
                        <span className="project-item-icon">
                          <Puzzle size={19} />
                        </span>
                        <span className="project-item-copy">
                          <strong>{project.name}</strong>
                          <small>{project.id}</small>
                        </span>
                        <span className={`project-status ${
                          project.manifestStatus === 'valid' ? 'valid' : 'invalid'
                        }`}>
                          {project.manifestStatus === 'valid' ? 'Valid' : 'Invalid'}
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>

                  <div className="project-details">
                    {selectedProject ? (
                      <>
                        <div className="project-detail-header">
                          <div className="project-item-icon large">
                            <FolderOpen size={23} />
                          </div>
                          <div>
                            <span className="section-kicker">PROJECT DETAILS</span>
                            <h3>{selectedProject.name}</h3>
                            <p>{selectedProject.id}</p>
                          </div>
                        </div>

                        <div className="project-detail-meta">
                          <div>
                            <span>Version</span>
                            <strong>{selectedProject.version || 'Not defined'}</strong>
                          </div>
                          <div>
                            <span>Manifest</span>
                            <strong className={
                              selectedProject.manifestStatus === 'valid'
                                ? 'project-stat-good'
                                : 'project-stat-warning'
                            }>
                              {selectedProject.manifestStatus === 'valid'
                                ? 'Valid'
                                : 'Invalid'}
                            </strong>
                          </div>
                        </div>

                        <h4>Project structure</h4>
                        {selectedProject.manifestIssues?.length > 0 && (
                          <div className="project-issue-list">
                            <h4>Manifest issues</h4>
                            {selectedProject.manifestIssues.map((issue, index) => (
                              <div className="project-issue" key={index}>
                                <AlertTriangle size={14} />
                                <span>{issue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedProject.projectIssues?.length > 0 && (
                          <div className="project-issue-list">
                            <h4>Validation issues</h4>
                            {selectedProject.projectIssues.map((issue, index) => (
                              <div className="project-issue" key={index}>
                                <AlertTriangle size={14} />
                                <span>{issue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="project-file-list">
                          <div>
                            <FileCode2 size={17} />
                            <span>manifest.json</span>
                            <span className="file-present">
                              {selectedProject.manifestStatus === 'valid'
                                ? 'Detected'
                                : 'Invalid'}
                            </span>
                          </div>
                          <div>
                            <Code2 size={17} />
                            <span>renderer/</span>
                            <span className={selectedProject.renderer ? 'file-present' : 'file-missing'}>
                              {selectedProject.renderer ? 'Present' : 'Missing'}
                            </span>
                          </div>
                          <div>
                            <FileCode2 size={17} />
                            <span>README.md</span>
                            <span className={selectedProject.readme ? 'file-present' : 'file-missing'}>
                              {selectedProject.readme ? 'Present' : 'Missing'}
                            </span>
                          </div>
                          <div>
                            <FileCode2 size={17} />
                            <span>LICENSE</span>
                            <span className={selectedProject.license ? 'file-present' : 'file-missing'}>
                              {selectedProject.license ? 'Present' : 'Missing'}
                            </span>
                          </div>
                        </div>

                        <div className="project-detail-note">
                          <AlertTriangle size={16} />
                          <p>
                            These indicators describe the local inventory only.
                            They do not confirm compatibility with the official
                            Mosaic Companion runtime.
                          </p>
                        </div>

                        <button
                          className="primary-button project-validate-button"
                          onClick={() => {
                            setId(selectedProject.id)
                            setNotice(null)
                            navigate('validator')
                          }}
                        >
                          <ShieldCheck size={16} />
                          Validate this project
                        </button>
                      </>
                    ) : (
                      <div className="project-empty project-select-prompt">
                        <FolderOpen size={30} />
                        <strong>Select a project</strong>
                        <span>Choose a project from the list to inspect its details.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeView === 'builder' && (
            <>
              <div className="page-intro">
                <div className="eyebrow"><Puzzle size={14} /> PROJECT CREATION</div>
                <h1>Add-on Builder</h1>
                <p>Define your add-on details. Studio will generate a starter project in your local workspace.</p>
              </div>

              <div className="builder-layout">
                <section className="content-card builder-card">
                  <div className="card-heading">
                    <div className="heading-icon"><FolderPlus size={19} /></div>
                    <div><h3>Project details</h3><p>Start with the essentials. You can expand your add-on later.</p></div>
                  </div>

                  <div className="form-section-label"><span>01</span> BASIC INFORMATION</div>
                  <label htmlFor="addon-name">Add-on name <span className="required">*</span></label>
                  <input id="addon-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Node Monitor" maxLength={40} />
                  <div className="input-meta"><span>A clear, human-readable name.</span><span>{name.length}/40</span></div>

                  <label htmlFor="addon-id">Unique project ID <span className="required">*</span></label>
                  <input id="addon-id" className={!validId ? 'input-error' : ''} value={id} onChange={e => setId(e.target.value)} placeholder="e.g. node-monitor" maxLength={41} spellCheck="false" />
                  <div className="input-meta"><span>Lowercase letters, numbers and hyphens. Starts with a letter.</span><span>{id.length}/41</span></div>
                  {!validId && <div className="field-feedback error"><AlertTriangle size={14} /> Use a valid ID with 2–41 characters.</div>}

                  <label htmlFor="addon-description">Description <span className="required">*</span></label>
                  <textarea id="addon-description" rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="What does your add-on do?" maxLength={200} />
                  <div className="input-meta"><span>Explain the purpose of your add-on.</span><span>{description.length}/200</span></div>

                  <div className="form-section-label license-label"><span>02</span> LICENSE</div>
                  <label htmlFor="addon-license">Open-source license</label>
                  <select id="addon-license" value={license} onChange={e => setLicense(e.target.value)}>
                    <option value="MIT">MIT License</option>
                    <option value="Apache-2.0">Apache License 2.0</option>
                    <option value="GPL-3.0-or-later">GNU GPL v3 or later</option>
                    <option value="pending">Choose later (not publication-ready)</option>
                  </select>
                  <div className="license-note"><LockKeyhole size={15} /> A complete license file will be generated with your project.</div>

                  <div className="form-section-label license-label"><span>03</span> PUBLICATION DETAILS</div>
                  <label htmlFor="addon-author">Author <span className="optional">optional</span></label>
                  <input id="addon-author" value={author} onChange={e => setAuthor(e.target.value)} placeholder="e.g. Your Name" maxLength={100} />
                  <div className="input-meta"><span>Shown to reviewers and users. The Mosaic catalogue requires a licence and an author to be named in the pull request.</span><span>{author.length}/100</span></div>

                  <label htmlFor="addon-homepage">Homepage <span className="optional">optional</span></label>
                  <input id="addon-homepage" value={homepage} onChange={e => setHomepage(e.target.value)} placeholder="https://example.com" />
                  <div className="input-meta"><span>An http or https URL for the project.</span></div>

                  <label htmlFor="addon-min-version">Minimum Mosaic version <span className="optional">optional</span></label>
                  <input id="addon-min-version" value={minAppVersion} onChange={e => setMinAppVersion(e.target.value)} placeholder="e.g. 0.1.13" spellCheck="false" />
                  <div className="input-meta"><span>The oldest Mosaic version this add-on supports. Use a SemVer version.</span></div>

                  <div className="builder-actions">
                    <button className="primary-button" onClick={createAddon} disabled={busy || apiStatus !== 'online' || !validId || !validName || !validDescription}>
                      {busy ? <RefreshCw className="spin" size={17} /> : <FolderPlus size={17} />}
                      {busy ? 'Creating project...' : 'Generate add-on project'}
                    </button>
                    <button className="subtle-button" onClick={() => navigate('dashboard')}>Cancel</button>
                  </div>
                  {apiStatus !== 'online' && <div className="field-feedback error"><AlertTriangle size={14} /> {host.host === 'mosaic' ? 'Mosaic must be reachable to create a project.' : 'The local API must be online to create a project.'}</div>}
                </section>

                <aside className="builder-aside">
                  <section className="content-card preview-card">
                    <div className="card-heading preview-heading">
                      <div className="heading-icon"><FileCode2 size={18} /></div>
                      <div><h3>Live manifest preview</h3><p>Updates as you edit</p></div>
                    </div>
                    <div className="code-window">
                      <div className="code-toolbar"><span className="code-dots"><i /><i /><i /></span><span>manifest.json</span><button onClick={() => copyText(jsonText)} aria-label="Copy manifest"><Copy size={14} /></button></div>
                      <pre>{jsonText}</pre>
                    </div>
                    <button className="outline-button full-button" onClick={() => copyText(jsonText)}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? 'Copied!' : 'Copy manifest JSON'}
                    </button>
                  </section>

                  <section className="info-card">
                    <div className="info-card-icon"><ShieldCheck size={19} /></div>
                    <div><strong>Local-first and non-custodial</strong><p>Your project is generated locally. Studio does not need your wallet private keys or recovery phrase.</p></div>
                  </section>
                </aside>
              </div>
            </>
          )}

          {activeView === 'validator' && (
            <>
              <div className="page-intro">
                <div className="eyebrow"><ShieldCheck size={14} /> PROJECT QUALITY</div>
                <h1>Project Validator</h1>
                <p>Run local checks against an existing generated add-on and review the results.</p>
              </div>

              <section className="content-card validator-card">
                <div className="card-heading">
                  <div className="heading-icon green"><ShieldCheck size={19} /></div>
                  <div><h3>Validate an add-on</h3><p>Enter the project ID from your {host.host === 'mosaic' ? "Studio's data directory" : 'generated-addons directory'}.</p></div>
                </div>
                <label htmlFor="validator-id">Project ID</label>
                <div className="validator-input-row">
                  <input id="validator-id" value={id} onChange={e => setId(e.target.value)} placeholder="e.g. node-monitor" maxLength={41} spellCheck="false" />
                  <button className="primary-button" onClick={validateAddon} disabled={busy || apiStatus !== 'online' || !validId}>
                    {busy ? <RefreshCw className="spin" size={16} /> : <ShieldCheck size={16} />}
                    {busy ? 'Checking...' : 'Run validation'}
                  </button>
                </div>
                <div className="input-meta"><span>{host.host === 'mosaic' ? 'Validation runs in this add-on, using the same rules as the local Studio.' : 'Validation runs through your local Studio API.'}</span><span>{id.length}/41</span></div>
              </section>

              {notice && (
                <section className={`content-card results-card ${notice.type}`}>
                  <div className="results-heading">
                    <div className={`result-symbol ${notice.type}`}>
                      {notice.type === 'success' ? <BadgeCheck size={22} /> : notice.type === 'warning' ? <AlertTriangle size={22} /> : <X size={22} />}
                    </div>
                    <div><span className="section-kicker">VALIDATION REPORT</span><h2>{notice.title}</h2></div>
                  </div>

                  {validation && (
                    <>
                      <div className="result-summary">
                        <div><span>Manifest checks</span><strong>{validation.valid ? 'Passed' : 'Issues found'}</strong></div>
                        <div><span>Publication readiness</span><strong>{validation.publishReady ? 'Ready' : 'Not ready'}</strong></div>
                        <div><span>Errors</span><strong>{validationErrors.length}</strong></div>
                        <div><span>Warnings</span><strong>{validationWarnings.length}</strong></div>
                      </div>
                      {validationChecks.length > 0 && <div className="result-list"><h3><Check size={16} /> Passed checks ({validationChecks.length})</h3>{validationChecks.map((item, index) => <div className="result-item pass" key={index}><Check size={15} />{item}</div>)}</div>}
                      {validationErrors.length > 0 && <div className="result-list"><h3><X size={16} /> Errors ({validationErrors.length})</h3>{validationErrors.map((item, index) => <div className="result-item fail" key={index}><AlertTriangle size={15} />{item}</div>)}</div>}
                      {validationWarnings.length > 0 && <div className="result-list"><h3><AlertTriangle size={16} /> Warnings ({validationWarnings.length})</h3>{validationWarnings.map((item, index) => <div className="result-item warning" key={index}><AlertTriangle size={15} />{item}</div>)}</div>}
                      {validation.reference && (
                        <p className="validation-reference">
                          Capability checks ran against Mosaic Companion <strong>{validation.reference.revision}</strong>
                          {validation.reference.commit ? ` (${validation.reference.commit.slice(0, 7)})` : ''}. The icon set, the API surface and each API&apos;s release floor are read from that revision, so a finding names the app it came from.
                        </p>
                      )}
                      <p className="validation-disclaimer">Local validation is not official Mosaic approval or a guarantee of runtime compatibility.</p>
                    </>
                  )}
                  {!validation && <pre className="raw-response">{notice.title}</pre>}
                  {notice.data && <button className="outline-button" onClick={() => copyText(JSON.stringify(notice.data, null, 2))}><Copy size={15} /> Copy report</button>}
                </section>
              )}

              {!notice && <section className="empty-state"><div><ShieldCheck size={30} /></div><h3>Ready when you are</h3><p>Run a validation to see project checks, errors and recommendations here.</p></section>}
            </>
          )}

          {activeView === 'settings' && (
            <>
              <div className="page-intro">
                <div className="eyebrow"><Settings size={14} /> WORKSPACE INFORMATION</div>
                <h1>Studio guidance</h1>
                <p>Understand how the local development workflow works and what to expect.</p>
              </div>
              <div className="settings-grid">
                <section className="content-card guidance-card"><div className="heading-icon"><Server size={19} /></div><h3>{host.host === 'mosaic' ? 'Mosaic Companion' : 'Local API'}</h3><p>{host.host === 'mosaic' ? 'The Studio runs inside Mosaic as an add-on. Projects live in this add-on own data directory.' : 'The Studio communicates with a local API service to generate and validate add-on projects.'}</p>{statusPill}</section>
                <section className="content-card guidance-card"><div className="heading-icon green"><ShieldCheck size={19} /></div><h3>Security first</h3><p>Generated code is not automatically executed. Never enter private keys, recovery phrases or wallet passwords.</p></section>
                <section className="content-card guidance-card"><div className="heading-icon violet"><FileCode2 size={19} /></div><h3>Project output</h3><p>{host.host === 'mosaic' ? 'Generated add-ons are written to this add-on own data directory. They are not your working directory.' : 'Generated add-ons are written to the project generated-addons directory. Review the files before use.'}</p></section>
                <section className="content-card guidance-card"><div className="heading-icon blue"><BadgeCheck size={19} /></div><h3>Official compatibility</h3><p>Local validation checks known project rules. Official Mosaic compatibility requires the appropriate review and approval process.</p></section>
              </div>
            </>
          )}

          {notice && activeView !== 'validator' && (
            <section className={`inline-notice ${notice.type}`} role="status" aria-live="polite">
              <div className="inline-notice-heading">
                {notice.type === 'error' ? <AlertTriangle size={17} /> : notice.type === 'warning' ? <AlertTriangle size={17} /> : <Check size={17} />}
                <strong>{notice.title}</strong>
              </div>
              {notice.data && (
                <div className="notice-details">
                  {notice.data.folder && <p><strong>Project folder:</strong> {notice.data.folder}</p>}
                  {notice.data.files && <p><strong>Generated files:</strong> {notice.data.files.join(', ')}</p>}
                  {notice.data.publishReady !== undefined && <p><strong>Publication readiness:</strong> {notice.data.publishReady ? 'Ready' : 'Not ready yet'}</p>}
                  {notice.data.errors?.length > 0 && <p><strong>Errors:</strong> {notice.data.errors.join(' · ')}</p>}
                  {notice.data.warnings?.length > 0 && <p><strong>Warnings:</strong> {notice.data.warnings.join(' · ')}</p>}
                </div>
              )}
              {notice.data && <button className="text-action" onClick={() => copyText(JSON.stringify(notice.data, null, 2))}><Copy size={14} /> Copy response</button>}
            </section>
          )}

          <footer className="app-footer">
            <div><Blocks size={15} /> MOSAIC STUDIO <span>•</span> {host.host === 'mosaic' ? 'ADD-ON WORKSPACE' : 'LOCAL DEVELOPMENT WORKSPACE'}</div>
            <span>Built for the Mosaic ecosystem</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

