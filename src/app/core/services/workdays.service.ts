import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Task } from 'src/app/shared/models/task';
import { Workday } from 'src/app/shared/models/workday';
import { environment } from 'src/environments/environment';
import { ToastrService } from './toastr.service';
import { ErrorService } from './error.service';
import { LoaderService } from './loader.service';
import { tap, catchError, finalize, switchMap } from 'rxjs/operators';
import { of, Observable } from 'rxjs';
import { DateService } from './date.service';

@Injectable({
  providedIn: 'root',
})
export class WorkdaysService {

  constructor(
    private http: HttpClient,
    private toastrService: ToastrService,
    private errorService: ErrorService,
    private loaderService: LoaderService,
    private dateService: DateService) { }


  // Enregistre une journée de travail dans Firestore.
  save(workday: Workday) {
    const url = `${environment.firebase.firestore.baseURL}/workdays?key=${environment.firebase.apiKey}`;
    const data = this.getWorkdayForFirestore(workday); // Formatte les données de la journée de travail pour Firestore.
    const jwt: string = localStorage.getItem('token')!;

    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      })
    };
    this.loaderService.setLoading(true);

    return this.http.post(url, data, httpOptions).pipe(
      tap(_ => this.toastrService.showToastr({
        category: 'success',
        message: 'Votre journée de travail a été enregistrée avec succès.'
      })),
      catchError(error => this.errorService.handleError(error)),
      finalize(() => this.loaderService.setLoading(false))
    );
  }

  // récupére une unique journée de travail, correspondant à une date en particulier. Cette date devient en quelque sorte son identifiant unique.
  getWorkdayByDate(date: string, userId: string): Observable<Workday | null> {
    const url = `${environment.firebase.firestore.baseURL}:runQuery?key=${environment.firebase.apiKey}`;
    const data = this.getSructuredQuery(date, userId);
    const jwt: string = localStorage.getItem('token')!;

    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      })
    };

    return this.http.post(url, data, httpOptions).pipe(
      switchMap((data: any) => {
        const document = data[0].document;
        if (!document) {
          return of(null);
        }
        return of(this.getWorkdayFromFirestore(document.name, document.fields));
      })
    );
  }

  // récupére les données brutes stockées dans le Firestore pour en faire un modèle métier.
  private getWorkdayFromFirestore(name: string, fields: any): Workday {
    const tasks: Task[] = [];
    const workdayId: string = name.split('/')[6];

    fields.tasks.arrayValue.values.forEach((data: any) => {
      const task: Task = new Task({
        completed: data.mapValue.fields.completed.booleanValue,
        done: data.mapValue.fields.done.integerValue,
        title: data.mapValue.fields.title.stringValue,
        todo: data.mapValue.fields.todo.integerValue
      });
      tasks.push(task);
    });

    return new Workday({
      id: workdayId,
      userId: fields.userId.stringValue,
      notes: fields.notes.stringValue,
      displayDate: fields.displayDate.stringValue,
      dueDate: fields.dueDate.integerValue,
      tasks: tasks
    });
  }

  // fournir les informations nécessaires à notre requête pour le Firestore
  private getSructuredQuery(date: string, userId: string): any {
    return {
      'structuredQuery': {
        'from': [{
          'collectionId': 'workdays'
        }],
        'where': {
          'compositeFilter': {
            'op': 'AND',
            'filters': [
              {
                'fieldFilter': {
                  'field': { 'fieldPath': 'displayDate' }, // displayDate : champ sur lequel on construit notre requête.
                  'op': 'EQUAL',
                  'value': { 'stringValue': date } // vérifie si la date d’affichage correspond à la date passée en paramètre.
                  // ainsi, getWorkdayByDate() renverra la journée de travail correspondant à cette date (ou null si aucune n'est trouvée).
                }
              },
              {
                'fieldFilter': {
                  'field': { 'fieldPath': 'userId' },
                  'op': 'EQUAL',
                  'value': { 'stringValue': userId }
                }
              }
            ]
          }
        },
        'limit': 1
      }
    };
  }

  // Retourne le corps de la requête globale à envoyé a API Rest de Firestore :
  private getWorkdayForFirestore(workday: Workday): any {
    let dueDate: number; // Timestamp traditionnelle en secondes.
    let dueDateMs: number; // Timestamp JavaScript en millisecondes.

    // gestion du cas où une date serait une date JavaScript provenant du formulaire des Workdays, ou un timestamp provenant du Firestore.
    if (typeof workday.dueDate == 'string') {
      dueDate = +workday.dueDate;
      dueDateMs = dueDate * 1000;
    } else {
      dueDate = new Date(workday.dueDate).getTime() / 1000;
      dueDateMs = dueDate * 1000;
    }

    // calcul de la date d’affichage grâce à getDisplayDate() et au timestamp de JavaScript.
    const displayDate: string = this.dateService.getDisplayDate(new Date(dueDateMs)); // La nouvelle propriété displayDate est prise en compte.
    const tasks: Object = this.getTaskListForFirestore(workday.tasks);

    return {
      fields: {
        dueDate: { integerValue: dueDate }, // pousse le timestamp « normal » de la journée de travail vers le Firestore.
        displayDate: { stringValue: displayDate },
        tasks: tasks,
        notes: { stringValue: workday.notes },
        userId: { stringValue: workday.userId }
      }
    };
  }

  // Construit la partie du corps de la requête qui correspond à la liste des tâches.
  private getTaskListForFirestore(tasks: Task[]): any {
    const taskList: any = {
      arrayValue: {
        values: []
      }
    };
    // Construit la partie du corps de la requête qui correspond à une seule tâche.
    tasks.forEach(task => taskList.arrayValue.values.push(this.getTaskForFirestore(task)));

    return taskList;
  }

  // Formatte une tâche individuelle pour Firestore.
  private getTaskForFirestore(task: Task): any {
    return {
      mapValue: {
        fields: {
          title: { stringValue: task.title },
          todo: { integerValue: task.todo },
          done: { integerValue: task.done },
          completed: { booleanValue: false }
        }
      }
    }
  }
}
