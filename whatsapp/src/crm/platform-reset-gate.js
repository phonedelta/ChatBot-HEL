function createPlatformResetGate() {
  const activeTasks = new Set()
  let active = false
  let releaseWaiters = null
  let waitPromise = Promise.resolve()

  function isActive() {
    return active
  }

  function wait() {
    return active ? waitPromise : Promise.resolve()
  }

  async function run(action) {
    await wait()
    const task = Promise.resolve().then(action)
    activeTasks.add(task)
    try {
      return await task
    } finally {
      activeTasks.delete(task)
    }
  }

  async function begin() {
    if (active) {
      const error = new Error('Platform reset already in progress')
      error.code = 'RESET_IN_PROGRESS'
      throw error
    }
    active = true
    waitPromise = new Promise((resolve) => {
      releaseWaiters = resolve
    })
    await Promise.allSettled(Array.from(activeTasks))
  }

  function end() {
    active = false
    const release = releaseWaiters
    releaseWaiters = null
    waitPromise = Promise.resolve()
    release?.()
  }

  return {
    begin,
    end,
    isActive,
    run,
    wait,
  }
}

module.exports = {
  createPlatformResetGate,
}
