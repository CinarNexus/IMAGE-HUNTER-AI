import cvModule from '@techstark/opencv-js'

let cvPromise
let processingQueue = Promise.resolve()

export async function getOpenCv() {
  if (!cvPromise) {
    cvPromise = cvModule instanceof Promise
      ? cvModule
      : cvModule.Mat
        ? Promise.resolve(cvModule)
        : new Promise((resolve, reject) => {
          const previousHandler = cvModule.onRuntimeInitialized
          cvModule.onRuntimeInitialized = () => {
            previousHandler?.()
            resolve(cvModule)
          }
          cvModule.onAbort = (reason) => reject(new Error(`OpenCV başlatılamadı: ${reason}`))
        })
  }
  return cvPromise
}

export function withOpenCv(operation) {
  const task = processingQueue.then(async () => operation(await getOpenCv()))
  processingQueue = task.catch(() => {})
  return task
}
