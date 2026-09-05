/**
 * Smart Mini CRM dashboard API routes.
 * Mounted under /dashboard/api — requires ensureDashboardSession middleware.
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { PERMISSIONS } = require('./permissions')
const { getAuthenticatedActor } = require('../crm/smart/activity-actors')

function dashboardActor(req) {
  return getAuthenticatedActor(req.dashboardUser)
}

function actorDisplayName(req) {
  return req.dashboardUser?.displayName || 'Assistante'
}

/**
 * @param {{
 *   getSmart: () => object|null,
 *   getCrm: () => object|null,
 *   assertPermission?: Function,
 *   sendWhatsAppText?: Function,
 *   sendWhatsAppImage?: Function,
 *   resolveCrmMediaAbsolutePath?: Function,
 *   persistCrmMediaFile?: Function,
 *   dashboardImageMaxBytes?: number,
 *   allowedDashboardImageMimes?: Set<string>,
 * }} deps
 */
function createSmartCrmRouter(deps) {
  const router = express.Router()
  const maxImageBytes = Number(deps.dashboardImageMaxBytes || 10 * 1024 * 1024)
  const allowedMimes = deps.allowedDashboardImageMimes
    || new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(process.cwd(), 'storage', 'tmp-uploads')
        fs.mkdirSync(dir, { recursive: true })
        cb(null, dir)
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 10)
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`)
      },
    }),
    limits: { fileSize: maxImageBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const mime = String(file.mimetype || '').toLowerCase()
      const ext = path.extname(String(file.originalname || '')).toLowerCase()
      const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
      if (
        allowedMimes.has(mime)
        || mime.startsWith('image/')
        || ((mime === '' || mime === 'application/octet-stream') && extOk)
      ) {
        return cb(null, true)
      }
      const err = new Error('Ce type de fichier n’est pas pris en charge.')
      err.code = 'MEDIA_TYPE'
      return cb(err)
    },
  })

  function smartOr503(res) {
    const smart = deps.getSmart?.() || null
    if (!smart) {
      res.status(503).json({ ok: false, error: 'CRM / Smart CRM désactivé' })
      return null
    }
    return smart
  }

  function cleanupUpload(file) {
    if (file?.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path) } catch { /* ignore */ }
    }
  }

  function conversationOutboundPhone(conversation) {
    return conversation?.phone_e164
      || conversation?.patient_phone
      || conversation?.phone_display
      || null
  }

  function perm(req, res, key) {
    if (!deps.assertPermission) return true
    return deps.assertPermission(req, res, key)
  }

  router.get('/today', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_TODAY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, ...smart.getTodayDashboard() })
  })

  router.get('/search', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_PATIENTS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const q = String(req.query.q || '').trim()
    return res.json({ ok: true, query: q, ...smart.globalSearch(q, { limit: Number(req.query.limit || 20) }) })
  })

  router.get('/conversations', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_MESSAGES)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    smart.ensureConversationsFromLegacy()
    const items = smart.listConversations({
      status: req.query.status || null,
      limit: req.query.limit,
      query: req.query.q || '',
    })
    return res.json({ ok: true, conversations: items })
  })

  router.get('/conversations/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_MESSAGES)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const conversation = smart.getConversation(req.params.id)
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
    const messages = smart.listMessages(conversation.id)
    let patient = null
    if (conversation.customer_id) {
      patient = smart.getPatientDetail(conversation.customer_id)
    }
    const suggestion = smart.buildConversationSuggestion(conversation)
    const handoffBanner = conversation.owner === 'HUMAN'
      ? `${conversation.owner_user || 'L’assistante'} a repris la conversation. L’automatisation est temporairement suspendue.`
      : null
    return res.json({
      ok: true,
      conversation,
      messages,
      patient,
      suggestion,
      handoff_banner: handoffBanner,
    })
  })

  router.get('/conversations/:id/context', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_MESSAGES)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const context = smart.getConversationContext(req.params.id)
    if (!context) return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
    return res.json({ ok: true, context })
  })

  router.get('/conversations/:id/messages/:messageId/media', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_MESSAGES)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const conversation = smart.getConversation(req.params.id)
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
    const message = smart.getMessage?.(req.params.messageId)
    if (!message || Number(message.conversation_id) !== Number(conversation.id)) {
      return res.status(404).json({ ok: false, error: 'Média introuvable' })
    }
    if (!message.media_path) {
      return res.status(404).json({ ok: false, error: 'Aucun média' })
    }
    const absolute = deps.resolveCrmMediaAbsolutePath?.(message.media_path)
    if (!absolute) return res.status(404).json({ ok: false, error: 'Fichier média introuvable' })
    res.setHeader('Content-Type', message.media_mime || 'application/octet-stream')
    if (message.media_filename) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(message.media_filename).replace(/"/g, '')}"`,
      )
    }
    return res.sendFile(absolute)
  })

  router.post('/conversations/:id/messages', (req, res) => {
    if (!perm(req, res, PERMISSIONS.SEND_MANUAL_MESSAGE)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined

    upload.single('image')(req, res, async (uploadError) => {
      if (uploadError) {
        const code = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400
        const message = uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'L’image est trop volumineuse.'
          : (uploadError.message || 'Fichier invalide')
        return res.status(code).json({ ok: false, error: message })
      }

      const uploaded = req.file || null
      try {
        const conversation = smart.getConversation(req.params.id)
        if (!conversation) {
          cleanupUpload(uploaded)
          return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
        }
        if (conversation.owner !== 'HUMAN') {
          cleanupUpload(uploaded)
          return res.status(409).json({
            ok: false,
            error: 'Prenez la main avant d’envoyer un message manuel',
            code: 'HANDOFF_REQUIRED',
          })
        }

        const body = String(req.body?.body || req.body?.caption || '').trim()
        const hasImage = Boolean(uploaded)
        if (!body && !hasImage) {
          cleanupUpload(uploaded)
          return res.status(400).json({ ok: false, error: 'Message vide' })
        }

        const authorName = actorDisplayName(req)
        const phone = conversationOutboundPhone(conversation)

        if (hasImage) {
          const mime = String(uploaded.mimetype || '').toLowerCase()
          const ext = path.extname(String(uploaded.originalname || '')).toLowerCase()
          const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
          if (!allowedMimes.has(mime) && !mime.startsWith('image/') && !((!mime || mime === 'application/octet-stream') && extOk)) {
            cleanupUpload(uploaded)
            return res.status(400).json({ ok: false, error: 'Ce type de fichier n’est pas pris en charge.' })
          }
          if (Number(uploaded.size || 0) > maxImageBytes) {
            cleanupUpload(uploaded)
            return res.status(413).json({ ok: false, error: 'L’image est trop volumineuse.' })
          }
          const sendFn = deps.sendWhatsAppImage
          if (typeof sendFn !== 'function') {
            cleanupUpload(uploaded)
            return res.status(503).json({ ok: false, error: 'Envoi WhatsApp indisponible' })
          }

          let sent
          try {
            sent = await sendFn({
              chatId: conversation.external_key,
              phone,
              caption: body,
              filePath: uploaded.path,
              filename: uploaded.originalname || uploaded.filename,
              mimeType: mime,
            })
          } catch (error) {
            cleanupUpload(uploaded)
            return res.status(502).json({
              ok: false,
              error: error.message || 'Impossible d’envoyer l’image. Réessayez.',
            })
          }

          const persisted = deps.persistCrmMediaFile?.(uploaded.path, {
            conversationKey: conversation.external_key || String(conversation.id),
            filename: uploaded.originalname || 'image.jpg',
            mimeType: mime,
          })

          const message = smart.addMessage(conversation.id, {
            direction: 'outbound',
            author_type: 'human',
            author_name: authorName,
            body,
            message_type: 'image',
            external_message_id: sent?.messageId || null,
            media_path: persisted?.mediaPath || null,
            media_mime: mime,
            media_filename: uploaded.originalname || persisted?.mediaFilename || null,
            media_size: uploaded.size,
          })

          smart.logAiAction({
            conversation_id: conversation.id,
            customer_id: conversation.customer_id,
            action_type: 'human_reply_sent',
            reason: 'Image assistante envoyée via WhatsApp',
            result: sent?.messageId || 'sent',
            actor_type: 'human',
            source: 'dashboard',
          })

          cleanupUpload(uploaded)
          return res.status(201).json({
            ok: true,
            message,
            delivery: 'whatsapp',
            chat_id: sent?.chatId || null,
            provider_message_id: sent?.messageId || null,
          })
        }

        const sendFn = deps.sendWhatsAppText
        if (typeof sendFn !== 'function') {
          return res.status(503).json({ ok: false, error: 'Envoi WhatsApp indisponible' })
        }

        let sent
        try {
          sent = await sendFn({
            chatId: conversation.external_key,
            phone,
            text: body,
          })
        } catch (error) {
          return res.status(502).json({
            ok: false,
            error: error.message || 'Impossible d’envoyer le message. Réessayez.',
          })
        }

        const message = smart.addMessage(conversation.id, {
          direction: 'outbound',
          author_type: 'human',
          author_name: authorName,
          body,
          external_message_id: sent?.messageId || null,
        })

        smart.logAiAction({
          conversation_id: conversation.id,
          customer_id: conversation.customer_id,
          action_type: 'human_reply_sent',
          reason: 'Message assistante envoyé via WhatsApp',
          result: sent?.messageId || 'sent',
          actor_type: 'human',
          source: 'dashboard',
        })

        return res.status(201).json({
          ok: true,
          message,
          delivery: 'whatsapp',
          chat_id: sent?.chatId || null,
          provider_message_id: sent?.messageId || null,
        })
      } catch (error) {
        cleanupUpload(uploaded)
        return res.status(500).json({ ok: false, error: error.message || 'Erreur serveur' })
      }
    })
  })

  router.post('/conversations/:id/handoff', (req, res) => {
    const owner = String(req.body?.owner || 'HUMAN').toUpperCase()
    const needed = owner === 'HUMAN'
      ? PERMISSIONS.TAKE_OVER_CONVERSATION
      : PERMISSIONS.RETURN_CONVERSATION_TO_AI
    if (!perm(req, res, needed)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const actor = dashboardActor(req)
    const conversation = smart.setHandoff(req.params.id, {
      owner,
      owner_user: owner === 'HUMAN' ? actorDisplayName(req) : null,
      actor,
    })
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
    return res.json({
      ok: true,
      conversation,
      message: owner === 'HUMAN'
        ? `${conversation.owner_user || 'L’assistante'} a repris la conversation. L’automatisation est temporairement suspendue.`
        : 'La conversation est de nouveau gérée par l’IA.',
    })
  })

  router.patch('/conversations/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_MESSAGES)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const conversation = smart.updateConversation(req.params.id, req.body || {})
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation introuvable' })
    return res.json({ ok: true, conversation })
  })

  router.get('/patients', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_PATIENTS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined

    if (typeof smart.listPatientsBoard === 'function') {
      const board = smart.listPatientsBoard({
        query: req.query.q || req.query.search || '',
        filter: req.query.filter || req.query.status || 'all',
        page: req.query.page || 1,
        limit: req.query.limit || 25,
        sort: req.query.sort || 'action',
      })
      return res.json(board)
    }

    // Legacy fallback
    const crm = deps.getCrm?.() || null
    if (!crm) return res.status(503).json({ ok: false, error: 'CRM désactivé' })
    const customers = crm.repo.listCustomers({
      limit: req.query.limit || 50,
      query: req.query.q || '',
    })
    const enriched = customers.map((c) => {
      const detail = smart.getPatientDetail(c.id)
      return {
        ...c,
        next_appointment: detail?.next_appointment || null,
        last_contact_at: c.last_contact_at || detail?.last_appointment?.created_at || null,
        next_action: detail?.next_action || null,
        tags: detail?.tags || [],
      }
    })
    return res.json({ ok: true, patients: enriched })
  })

  router.get('/patients/:id/context', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_PATIENTS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const context = smart.getPatientContext?.(req.params.id)
    if (!context) return res.status(404).json({ ok: false, error: 'Patient introuvable' })
    return res.json(context)
  })

  router.post('/patients', (req, res) => {
    if (!perm(req, res, PERMISSIONS.CREATE_PATIENT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      const result = smart.createManualPatient({
        fullName: req.body?.full_name || req.body?.fullName,
        phoneNumber: req.body?.phone_number || req.body?.phoneNumber,
        city: req.body?.city || null,
        language: req.body?.language || req.body?.preferred_language || 'fr',
        linkContactPhone: req.body?.link_contact_phone || req.body?.contact_phone || null,
      })
      if (result.created) {
        smart.recordActivity({
          event_type: 'patient_updated',
          category: 'patient',
          actor: dashboardActor(req),
          source: 'dashboard',
          patient_id: result.patient?.id,
          title: 'Patient créé',
          description: result.patient?.full_name || null,
          source_event_id: `patient:created:${result.patient?.id}`,
        })
      }
      return res.status(201).json(result)
    } catch (error) {
      const code = error.code === 'VALIDATION' ? 400 : 400
      return res.status(code).json({ ok: false, error: error.message || 'Création impossible' })
    }
  })

  router.get('/patients/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_PATIENTS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const detail = smart.getPatientDetail(req.params.id)
    if (!detail) return res.status(404).json({ ok: false, error: 'Patient introuvable' })
    return res.json({ ok: true, ...detail })
  })

  router.post('/patients/:id/notes', (req, res) => {
    if (!perm(req, res, PERMISSIONS.EDIT_PATIENT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const body = String(req.body?.body || '').trim()
    if (!body) return res.status(400).json({ ok: false, error: 'Note vide' })
    const note = smart.addPatientNote(
      req.params.id,
      body,
      { actor: dashboardActor(req) },
    )
    return res.status(201).json({ ok: true, note })
  })

  router.post('/patients/:id/tags', (req, res) => {
    if (!perm(req, res, PERMISSIONS.EDIT_PATIENT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      const tags = smart.addPatientTag(req.params.id, req.body?.tag)
      return res.status(201).json({ ok: true, tags })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Tag invalide' })
    }
  })

  router.get('/agenda', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_AGENDA)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined

    const payload = smart.getAgendaBoard({
      from: req.query.from || req.query.date || null,
      to: req.query.to || null,
      view: req.query.view || 'week',
      practitionerId: req.query.practitionerId || req.query.practitioner_id || null,
      type: req.query.type || null,
      status: req.query.status || null,
    })
    return res.json(payload)
  })

  router.get('/agenda/appointments/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_AGENDA)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const appointment = smart.getAgendaAppointment?.(req.params.id)
    if (!appointment) {
      return res.status(404).json({ ok: false, error: 'Rendez-vous introuvable' })
    }
    return res.json({ ok: true, appointment })
  })

  router.post('/agenda/propose', async (req, res) => {
    if (!perm(req, res, PERMISSIONS.PROPOSE_SLOT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    // Legacy endpoint — redirected to manual single-patient proposal
    try {
      const customerId = Number(req.body?.customer_id || req.body?.patientId || 0)
      const appointmentId = Number(req.body?.appointment_id || req.body?.appointmentId || 0)
      if (!customerId || !appointmentId) {
        return res.status(400).json({
          ok: false,
          error: 'Sélectionnez un patient avec un rendez-vous actif (customer_id + appointment_id).',
        })
      }
      const result = await smart.createSlotProposal({
        customerId,
        appointmentId,
        slotDate: req.body?.slot_date,
        slotTime: req.body?.slot_time,
        durationMinutes: req.body?.duration_minutes || null,
        practitionerId: req.body?.practitioner_id || null,
        createdBy: actorDisplayName(req),
        actor: dashboardActor(req),
        chatKey: req.body?.chat_key || null,
      })
      return res.status(201).json({ ok: true, ...result })
    } catch (error) {
      const code = error.code === 'SLOT_TAKEN' || error.code === 'SLOT_LOCKED' ? 409 : 400
      return res.status(code).json({ ok: false, error: error.message || 'Proposition impossible' })
    }
  })

  router.get('/agenda/patients-for-slot', (req, res) => {
    // Used by propose (PROPOSE_SLOT) and move-from-slot (EDIT_APPOINTMENT)
    const { hasPermission } = require('./permissions')
    if (
      !hasPermission(req.dashboardUser, PERMISSIONS.PROPOSE_SLOT)
      && !hasPermission(req.dashboardUser, PERMISSIONS.EDIT_APPOINTMENT)
    ) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'Vous n’avez pas l’autorisation d’effectuer cette action.',
      })
    }
    const smart = smartOr503(res)
    if (!smart) return undefined
    const q = String(req.query.q || '').trim()
    if (q.length < 2) {
      return res.json({ ok: true, patients: [] })
    }
    return res.json({
      ok: true,
      patients: smart.searchPatientsForSlot(q, { limit: Number(req.query.limit || 20) }),
    })
  })

  router.post('/agenda/slot-proposals', async (req, res) => {
    if (!perm(req, res, PERMISSIONS.PROPOSE_SLOT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      if (typeof deps.sendWhatsAppText === 'function') {
        smart.setSlotProposalSender?.(deps.sendWhatsAppText)
      }
      const result = await smart.createSlotProposal({
        customerId: Number(req.body?.customer_id || req.body?.patientId),
        appointmentId: Number(req.body?.appointment_id || req.body?.appointmentId),
        slotDate: req.body?.slot_date || req.body?.slotDate,
        slotTime: req.body?.slot_time || req.body?.slotTime,
        durationMinutes: req.body?.duration_minutes || null,
        practitionerId: req.body?.practitioner_id || null,
        createdBy: actorDisplayName(req),
        actor: dashboardActor(req),
        chatKey: req.body?.chat_key || null,
      })
      return res.status(201).json({ ok: true, ...result })
    } catch (error) {
      const code = error.code === 'SLOT_TAKEN' ? 409 : 400
      return res.status(code).json({ ok: false, error: error.message || 'Proposition impossible' })
    }
  })

  router.post('/agenda/appointments/:id/move', async (req, res) => {
    if (!perm(req, res, PERMISSIONS.EDIT_APPOINTMENT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      if (typeof deps.sendWhatsAppText === 'function') {
        smart.setSlotProposalSender?.(deps.sendWhatsAppText)
      }
      const moveOpts = {
        appointmentId: Number(req.params.id),
        slotDate: req.body?.slot_date || req.body?.slotDate,
        slotTime: req.body?.slot_time || req.body?.slotTime,
        practitionerId: req.body?.practitioner_id !== undefined
          ? req.body.practitioner_id
          : undefined,
        actor: dashboardActor(req),
        actorName: actorDisplayName(req),
        // Default: always WhatsApp-notify patient on staff move
        notifyPatient: req.body?.notify_patient === false || req.body?.notifyPatient === false
          ? false
          : true,
      }
      const result = typeof smart.moveAppointmentAndNotify === 'function'
        ? await smart.moveAppointmentAndNotify(moveOpts)
        : smart.moveAppointmentDirect(moveOpts)
      return res.json({ ok: true, ...result })
    } catch (error) {
      let code = 400
      if (error.code === 'SLOT_TAKEN' || error.code === 'OUTSIDE_HOURS') code = 409
      else if (error.code === 'NOT_FOUND') code = 404
      else if (error.code === 'SAME_SLOT') code = 400
      return res.status(code).json({ ok: false, error: error.message || 'Déplacement impossible' })
    }
  })

  router.post('/agenda/slot-proposals/:id/cancel', (req, res) => {
    if (!perm(req, res, PERMISSIONS.PROPOSE_SLOT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const result = smart.cancelSlotProposal(Number(req.params.id), {
      actor: dashboardActor(req),
      actorName: actorDisplayName(req),
    })
    if (!result.ok && result.reason === 'not_found') {
      return res.status(404).json({ ok: false, error: 'Proposition introuvable' })
    }
    return res.json({ ok: true, ...result })
  })

  router.get('/agenda/conversation-for-patient/:customerId', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_AGENDA)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const customerId = Number(req.params.customerId)
    if (!customerId) return res.status(400).json({ ok: false, error: 'patient invalide' })
    const conv = smart.listConversations({ limit: 100 })
      .find((c) => Number(c.customer_id) === customerId)
    if (!conv) return res.json({ ok: true, conversation_id: null })
    return res.json({ ok: true, conversation_id: conv.id })
  })

  router.get('/tasks', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({
      ok: true,
      tasks: smart.listTasks({
        status: req.query.status || null,
        category: req.query.category || null,
        limit: req.query.limit,
      }),
    })
  })

  router.get('/followups', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      if (typeof smart.getFollowUpsBoard !== 'function') {
        return res.status(503).json({
          ok: false,
          error: 'Module Relances indisponible — redémarrez le serveur WhatsApp.',
        })
      }
      const board = smart.getFollowUpsBoard({
        category: req.query.category || null,
        limit: req.query.limit || 80,
      })
      return res.json(board)
    } catch (error) {
      console.error('[smart-routes] followups failed', error)
      return res.status(500).json({
        ok: false,
        error: error.message || 'Impossible de charger les relances',
      })
    }
  })

  router.get('/followups/preview', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    if (typeof smart.previewManualFollowup !== 'function') {
      return res.status(503).json({ ok: false, error: 'Relances indisponibles — redémarrez le serveur.' })
    }
    const appointmentId = Number(req.query.appointment_id || req.query.appointmentId || 0)
    if (!appointmentId) {
      return res.status(400).json({ ok: false, error: 'appointment_id requis' })
    }
    try {
      const preview = smart.previewManualFollowup(appointmentId)
      if (!preview.ok) {
        return res.status(400).json({ ok: false, error: preview.error || preview.reason || 'Aperçu impossible' })
      }
      return res.json({ ok: true, ...preview })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Aperçu impossible' })
    }
  })

  router.post('/followups/remind', async (req, res) => {
    if (!perm(req, res, PERMISSIONS.SEND_MANUAL_FOLLOWUP)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    if (typeof smart.sendManualFollowup !== 'function') {
      return res.status(503).json({ ok: false, error: 'Relances indisponibles — redémarrez le serveur.' })
    }
    const appointmentId = Number(req.body?.appointment_id || req.body?.appointmentId || 0)
    if (!appointmentId) {
      return res.status(400).json({ ok: false, error: 'appointment_id requis' })
    }
    try {
      const result = await smart.sendManualFollowup(appointmentId, {
        actor: dashboardActor(req),
        actorName: actorDisplayName(req),
        textOverride: req.body?.message || req.body?.text || null,
      })
      if (!result.ok) {
        const status = result.reason === 'cooldown' ? 429 : 400
        return res.status(status).json({
          ok: false,
          error: result.error || result.reason || 'Relance impossible',
          reason: result.reason,
        })
      }
      return res.status(201).json({ ok: true, ...result })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Relance impossible' })
    }
  })

  router.get('/followups/validation-candidates', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VALIDATE_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    if (typeof smart.listFollowupValidationCandidates !== 'function') {
      return res.status(503).json({ ok: false, error: 'Relances indisponibles — redémarrez le serveur.' })
    }
    try {
      return res.json({ ok: true, ...smart.listFollowupValidationCandidates() })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Validation impossible' })
    }
  })

  router.post('/followups/validate-all', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VALIDATE_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    if (typeof smart.validateFollowupTasks !== 'function') {
      return res.status(503).json({ ok: false, error: 'Relances indisponibles — redémarrez le serveur.' })
    }
    try {
      const candidates = smart.listFollowupValidationCandidates()
      const requested = Array.isArray(req.body?.task_ids) ? req.body.task_ids : null
      const taskIds = requested?.length ? requested : candidates.task_ids
      const result = smart.validateFollowupTasks(taskIds, {
        actor: dashboardActor(req),
        actorName: actorDisplayName(req),
      })
      return res.json({
        ok: true,
        ...result,
        remaining: Math.max(0, (candidates.count || 0) - (result.validated || 0)),
      })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Validation impossible' })
    }
  })

  router.post('/tasks', (req, res) => {
    if (!perm(req, res, PERMISSIONS.SEND_MANUAL_FOLLOWUP)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const task = smart.createTask(req.body || {})
    return res.status(201).json({ ok: true, task })
  })

  router.patch('/tasks/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VALIDATE_FOLLOWUPS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const task = smart.updateTask(req.params.id, req.body || {})
    if (!task) return res.status(404).json({ ok: false, error: 'Tâche introuvable' })
    return res.json({ ok: true, task })
  })

  router.get('/waitlist', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_WAITLIST)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({
      ok: true,
      entries: smart.listWaitlist({
        status: req.query.status || 'active',
        limit: req.query.limit,
      }),
    })
  })

  router.post('/waitlist', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_WAITLIST)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      const entry = smart.createWaitlistEntry(req.body || {})
      return res.status(201).json({ ok: true, entry })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Impossible de créer l’entrée' })
    }
  })

  router.post('/waitlist/match', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_WAITLIST)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const slot_date = String(req.body?.slot_date || '').trim()
    const slot_time = String(req.body?.slot_time || '').trim()
    if (!slot_date || !slot_time) {
      return res.status(400).json({ ok: false, error: 'slot_date et slot_time requis' })
    }
    return res.json({
      ok: true,
      ...smart.matchWaitlistForSlot({ slot_date, slot_time, limit: req.body?.limit || 10 }),
    })
  })

  router.post('/waitlist/offer', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_WAITLIST)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    try {
      const offer = smart.createWaitlistOffer(req.body || {})
      return res.status(201).json({ ok: true, offer })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Offre impossible' })
    }
  })

  router.get('/automations', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_ASSISTANT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, automations: smart.listAutomations() })
  })

  router.patch('/automations/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_ASSISTANT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const automation = smart.updateAutomation(req.params.id, req.body || {})
    if (!automation) return res.status(404).json({ ok: false, error: 'Automatisation introuvable' })
    return res.json({ ok: true, automation })
  })

  router.get('/assistant', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_ASSISTANT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.getClinicSettings()
    const clinic = settings.clinic || {}
    const assistantRaw = settings.assistant || {}
    const languages = {
      fr: true,
      darija: true,
      ar: false,
      en: false,
      ...(clinic.languages || {}),
      ...(assistantRaw.languages || {}),
    }
    const knowledge = smart.listKnowledge()
    const filled = knowledge.filter((k) => k.status === 'filled' || (k.value && String(k.value).trim())).length
    return res.json({
      ok: true,
      assistant: {
        name: assistantRaw.name || 'Assistant du cabinet',
        tone: assistantRaw.tone || 'Professionnel et chaleureux',
        active: assistantRaw.active !== false,
        languages: {
          fr: Boolean(languages.fr),
          darija: Boolean(languages.darija),
        },
      },
      knowledge,
      knowledge_stats: { filled, total: knowledge.length },
    })
  })

  router.patch('/assistant', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_ASSISTANT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const assistant = smart.updateAssistantSettings(req.body || {}, {
      actor: dashboardActor(req),
    })
    return res.json({ ok: true, assistant })
  })

  router.get('/knowledge', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_KNOWLEDGE)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({
      ok: true,
      items: smart.listKnowledge({ category: req.query.category || null }),
    })
  })

  router.put('/knowledge', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_KNOWLEDGE)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const { category, key, label, value } = req.body || {}
    if (!category || !key) {
      return res.status(400).json({ ok: false, error: 'category et key requis' })
    }
    const item = smart.upsertKnowledgeItem({ category, key, label, value }, {
      actor: dashboardActor(req),
    })
    return res.json({ ok: true, item })
  })

  router.get('/analytics', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_ANALYTICS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const days = Number(req.query.days || req.query.period || 14)
    const from = req.query.from ? String(req.query.from) : null
    const to = req.query.to ? String(req.query.to) : null
    const practitionerId = req.query.practitionerId || req.query.practitioner_id || null
    const appointmentType = req.query.appointmentType || req.query.appointment_type || null
    const source = req.query.source || null
    return res.json({
      ok: true,
      ...smart.getAnalyticsSummary({
        days: Number.isFinite(days) && days > 0 ? days : 14,
        from,
        to,
        practitionerId,
        appointmentType,
        source,
      }),
    })
  })

  router.get('/integrations', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_INTEGRATIONS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    // Only surface integrations that are actually usable in the product today.
    // WhatsApp connection state comes from /dashboard/api/instances (real session).
    return res.json({
      ok: true,
      integrations: [
        {
          id: 'whatsapp',
          key: 'whatsapp',
          name: 'WhatsApp',
          available: true,
          description: 'Canal principal pour les conversations avec les patients.',
        },
      ],
    })
  })

  router.patch('/integrations/:key', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const integration = smart.updateIntegration(req.params.key, req.body || {})
    if (!integration) return res.status(404).json({ ok: false, error: 'Intégration introuvable' })
    return res.json({ ok: true, integration })
  })

  router.get('/settings', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, ...smart.getClinicSettings() })
  })

  router.patch('/settings/clinic', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_ASSISTANT)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const clinic = smart.updateClinicProfile(req.body || {})
    return res.json({ ok: true, clinic })
  })

  function settingsActor(req) {
    return {
      type: 'human',
      userId: req.dashboardUser?.id,
      displayName: req.dashboardUser?.displayName || req.dashboardUser?.username || 'Admin',
      role: req.dashboardUser?.role || 'admin',
    }
  }

  router.get('/settings/appointments', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, settings: smart.getAppointmentsSettings() })
  })

  router.put('/settings/appointments', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.updateAppointmentsSettings(req.body || {}, { actor: settingsActor(req) })
    return res.json({ ok: true, settings })
  })

  router.get('/settings/reminders', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, settings: smart.getRemindersSettings() })
  })

  router.put('/settings/reminders', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.updateRemindersSettings(req.body || {}, { actor: settingsActor(req) })
    return res.json({ ok: true, settings })
  })

  router.get('/settings/automations', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, settings: smart.getAutomationsSettings() })
  })

  router.put('/settings/automations', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.updateAutomationsSettings(req.body || {}, { actor: settingsActor(req) })
    return res.json({ ok: true, settings })
  })

  router.get('/settings/security', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, settings: smart.getSecuritySettings() })
  })

  router.put('/settings/security', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.updateSecuritySettings(req.body || {}, { actor: settingsActor(req) })
    return res.json({ ok: true, settings })
  })

  router.get('/settings/notifications', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    return res.json({ ok: true, settings: smart.getNotificationsSettings() })
  })

  router.put('/settings/notifications', (req, res) => {
    if (!perm(req, res, PERMISSIONS.MANAGE_SETTINGS)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const settings = smart.updateNotificationsSettings(req.body || {}, { actor: settingsActor(req) })
    return res.json({ ok: true, settings })
  })

  router.get('/notifications', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_TODAY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const board = smart.getNotificationsBoard({
      limit: req.query.limit || 30,
      unreadOnly: String(req.query.unread || '') === '1',
    })
    const alertPreferences = smart.getNotificationsSettings?.() || null
    return res.json({
      ok: true,
      notifications: board.items,
      items: board.items,
      unreadCount: board.unreadCount,
      alertPreferences,
    })
  })

  router.post('/notifications/:id/read', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_TODAY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const notification = smart.markNotificationRead(req.params.id)
    return res.json({ ok: true, notification })
  })

  router.post('/notifications/read-all', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_TODAY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const board = smart.markAllNotificationsRead()
    return res.json({ ok: true, ...board })
  })

  function historyFiltersFromQuery(req) {
    const actorParam = req.query.actorType || req.query.actor_type || req.query.actor || null
    const filters = {
      // Staff Historique page: humans only (allowlist dashboard_user).
      humansOnly: true,
      page: req.query.page,
      limit: req.query.limit,
      days: req.query.days,
      startDate: req.query.startDate || req.query.from || null,
      endDate: req.query.endDate || req.query.to || null,
      category: req.query.category || null,
      actorType: null,
      actorUserId: req.query.actorUserId || req.query.actor_user_id || null,
      actorId: req.query.actorId || req.query.actor_id || null,
      patientId: req.query.patientId || req.query.patient_id || null,
      conversationId: req.query.conversationId || req.query.conversation_id || null,
      appointmentId: req.query.appointmentId || req.query.appointment_id || null,
      search: req.query.search || req.query.q || null,
      severity: req.query.severity || null,
      typeFilter: req.query.type || req.query.filter || null,
    }
    if (actorParam && actorParam !== 'all') {
      if (String(actorParam).startsWith('user:')) {
        filters.actorUserId = Number(String(actorParam).slice(5))
        filters.actorType = 'dashboard_user'
      } else if (String(actorParam) === 'assistant_ai' || String(actorParam) === 'ai') {
        // Rejected by humansOnly allowlist — keep type so WHERE yields empty.
        filters.actorType = 'assistant_ai'
      } else if (String(actorParam) === 'dashboard_user' || String(actorParam) === 'human') {
        filters.actorType = 'dashboard_user'
      } else {
        filters.actorType = String(actorParam)
      }
    }
    return filters
  }

  router.get('/history/actors', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_HISTORY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const groups = smart.listHistoryActorFilters?.() || []
    return res.json({ ok: true, groups })
  })

  router.get('/history/export.csv', (req, res) => {
    if (!perm(req, res, PERMISSIONS.EXPORT_HISTORY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const csv = smart.exportActivityCsv(historyFiltersFromQuery(req))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="historique-hel.csv"')
    return res.send(`\uFEFF${csv}`)
  })

  router.get('/history/export.pdf', (req, res) => {
    if (!perm(req, res, PERMISSIONS.EXPORT_HISTORY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const pdf = smart.exportActivityPdf(historyFiltersFromQuery(req))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="historique-hel.pdf"')
    return res.send(pdf)
  })

  router.get('/history', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_HISTORY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    const filters = historyFiltersFromQuery(req)
    const { items, pagination } = smart.listActivityHistory(filters)
    const summary = smart.getActivitySummary(filters)
    return res.json({ ok: true, items, pagination, summary })
  })

  router.get('/history/:id', (req, res) => {
    if (!perm(req, res, PERMISSIONS.VIEW_HISTORY)) return undefined
    const smart = smartOr503(res)
    if (!smart) return undefined
    if (req.params.id === 'export.csv' || req.params.id === 'export.pdf') return undefined
    const item = smart.getActivityEvent(req.params.id)
    if (!item) return res.status(404).json({ ok: false, error: 'Événement introuvable' })
    // Historique staff: never expose IA / automation events via detail endpoint
    if (String(item.actor?.type || item.actor_type || '') !== 'dashboard_user') {
      return res.status(404).json({ ok: false, error: 'Événement introuvable' })
    }
    return res.json({ ok: true, item })
  })

  return router
}

module.exports = {
  createSmartCrmRouter,
}
